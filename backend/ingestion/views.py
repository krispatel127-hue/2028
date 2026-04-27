from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import IsAuthenticated
from rest_framework import generics
from django.db import OperationalError, InternalError, close_old_connections, connections
from django.db.models import Q
from django.core.cache import cache
from django.utils import timezone
from .models import Sheet, RecycleBinSheet, DataCleanerRun, DataCleanerRunPayload
from .services import process_file_data
from .processing_service import DataProcessingService
from .agent_analysis import AIAgentAnalyzer
from .universal_analysis import build_universal_analysis, detect_semantic_mapping
from .task_service import sync_task_records_for_upload
from .serializers import SheetSerializer, RecycleBinSheetSerializer, DataCleanerRunSerializer
import logging
import json
import time
import os
import math
import re
from django.http import StreamingHttpResponse
from rest_framework.renderers import BaseRenderer
from rest_framework.permissions import AllowAny
import pandas as pd
try:
    from google import genai  # type: ignore[reportMissingImports]
    from google.genai import types  # type: ignore[reportMissingImports]
except ImportError:
    genai = None
    types = None

logger = logging.getLogger(__name__)


def _to_json_db_safe(value):
    """Convert payload values to strict JSON-safe shape for MySQL JSON columns."""
    if value is None or isinstance(value, (str, bool, int)):
        return value

    if isinstance(value, float):
        return value if math.isfinite(value) else None

    if isinstance(value, dict):
        return {str(k): _to_json_db_safe(v) for k, v in value.items()}

    if isinstance(value, (list, tuple, set)):
        return [_to_json_db_safe(v) for v in value]

    item_getter = getattr(value, 'item', None)
    if callable(item_getter):
        try:
            return _to_json_db_safe(item_getter())
        except Exception:
            pass

    return str(value)




def _uploads_for_user_or_legacy(user):
    """Show current user's uploads and legacy unassigned uploads for backward compatibility."""
    if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
        return DataCleanerRun.objects.all()
    return DataCleanerRun.objects.filter(Q(uploaded_by=user) | Q(uploaded_by__isnull=True))


def _recent_upload_ids_for_user(user, limit=100):
    """Fetch recent run ids without expensive OR + ORDER BY query plans on MySQL."""
    limit = max(1, int(limit or 100))
    try:
        if getattr(user, 'is_superuser', False) or getattr(user, 'is_staff', False):
            return list(DataCleanerRun.objects.only('id').order_by('-id').values_list('id', flat=True)[:limit])

        own_ids = list(
            DataCleanerRun.objects.filter(uploaded_by=user)
            .only('id')
            .order_by('-id')
            .values_list('id', flat=True)[:limit]
        )
        if len(own_ids) >= limit:
            return own_ids

        need_legacy = limit - len(own_ids)
        legacy_ids = list(
            DataCleanerRun.objects.filter(uploaded_by__isnull=True)
            .only('id')
            .order_by('-id')
            .values_list('id', flat=True)[:need_legacy]
        )

        merged = own_ids + legacy_ids
        merged.sort(reverse=True)

        deduped = []
        seen = set()
        for run_id in merged:
            if run_id in seen:
                continue
            seen.add(run_id)
            deduped.append(run_id)
            if len(deduped) >= limit:
                break
        return deduped
    except OperationalError as exc:
        logger.warning('Recent upload id fetch fallback due DB error: %s', exc)
        return []


def _compute_sheet_size_from_payload(payload):
    schema = payload.get('schema_definition', []) if isinstance(payload, dict) else []
    rows = payload.get('current_data', []) if isinstance(payload, dict) else []
    # Size in bytes of the core sheet payload stored logically by frontend.
    packed = json.dumps({'schema_definition': schema, 'current_data': rows}, default=str)
    return len(packed.encode('utf-8'))


def _is_table_full_error(exc):
    code = exc.args[0] if getattr(exc, 'args', None) else None
    text = str(exc).lower()
    return code == 1114 or 'is full' in text


def _rows_have_inventory_markers_simple(rows):
    if not isinstance(rows, list) or not rows:
        return False
    sample = rows[: min(len(rows), 50)]
    keyset = set()
    for row in sample:
        if not isinstance(row, dict):
            continue
        for key in row.keys():
            keyset.add(str(key).strip().upper())
    required = {"PRODUCT", "IN/OUT", "QUANTITY", "CHECK QUANTITY", "DATE"}
    return required.issubset(keyset)


def _analysis_needs_strict_refresh(analysis):
    if not isinstance(analysis, dict):
        return True
    metadata = analysis.get('metadata') if isinstance(analysis.get('metadata'), dict) else {}
    quality = metadata.get('forecast_quality') if isinstance(metadata, dict) else None
    source = str(analysis.get('demand_forecast_source') or '')
    past_daily = analysis.get('past_sales_daily')
    if not isinstance(past_daily, list) or len(past_daily) == 0:
        return True
    if not isinstance(quality, dict):
        return True
    if source not in {'strict_clean_sales', 'insufficient_clean_signal'}:
        return True
    if not {'quality_score', 'date_coverage_ratio', 'sales_signal_ratio'}.issubset(set(quality.keys())):
        return True
    return False


def _prune_upload_payloads(keep_latest=6):
    """Release DB space by clearing large JSON payloads from older terminal uploads."""
    terminal_statuses = [DataCleanerRun.AnalysisStatus.COMPLETED, DataCleanerRun.AnalysisStatus.FAILED, DataCleanerRun.AnalysisStatus.SUCCESS]
    preserve_ids = list(
        DataCleanerRun.objects.order_by('-id').values_list('id', flat=True)[:keep_latest]
    )
    candidates = DataCleanerRunPayload.objects.filter(run__analysis_status__in=terminal_statuses).exclude(run_id__in=preserve_ids)
    try:
        # Preserve analysis_snapshot + processing_summary so history cards remain available.
        return candidates.update(raw_data=None, error_log=[])
    except OperationalError as prune_err:
        if not _is_table_full_error(prune_err):
            raise
        delete_ids = list(candidates.order_by('run_id').values_list('run_id', flat=True)[:20])
        if not delete_ids:
            return 0
        deleted_count, _ = DataCleanerRun.objects.filter(id__in=delete_ids).delete()
        return deleted_count


def _inject_sheet_metadata(analysis, upload):
    if not analysis or not isinstance(analysis, dict):
        return analysis

    analysis.setdefault('analysis_isolation', {})
    analysis['analysis_isolation'].setdefault('session_id', f'upload-{upload.id}')
    analysis['analysis_isolation']['sheet_id'] = upload.id
    analysis['analysis_isolation']['sheet_name'] = upload.uploaded_sheet_name
    analysis['analysis_isolation'].setdefault('analysis_mode', 'FULL')
    analysis['analysis_isolation'].setdefault('confidence', 'HIGH')

    analysis.setdefault('metadata', {})
    analysis['metadata'].setdefault('confidence', analysis['analysis_isolation'].get('confidence', 'HIGH'))
    analysis['metadata'].setdefault('analysis_mode', analysis['analysis_isolation'].get('analysis_mode', 'FULL'))
    
    # Ensure the critical metadata arrays exist for UI display
    analysis['metadata'].setdefault('ingestion_report', [])
    analysis['metadata'].setdefault('ingestion_warnings', [])
    analysis['metadata'].setdefault('sheet_diagnostics', [])
    analysis['metadata'].setdefault('sheet_analysis_summary', [])
    
    # Add basic ingestion report if missing
    if not analysis['metadata']['ingestion_report']:
        analysis['metadata']['ingestion_report'] = [
            f"Analysis completed for upload {upload.id}",
            f"Sheet: {upload.uploaded_sheet_name}",
            f"Status: {upload.analysis_status}",
        ]
    
    # Add sheet diagnostics if missing
    if not analysis['metadata']['sheet_diagnostics']:
        analysis['metadata']['sheet_diagnostics'] = [{
            'sheet_name': upload.uploaded_sheet_name or 'Unknown',
            'classification': 'TRANSACTION',
            'raw_rows': analysis.get('summary', {}).get('total_products', 0),
            'rows_after_clean': analysis.get('summary', {}).get('total_products', 0),
            'confidence': analysis.get('confidence_score', 75),
        }]
    
    # Add sheet analysis summary if missing
    if not analysis['metadata']['sheet_analysis_summary']:
        total_products = analysis.get('summary', {}).get('total_products', 0)
        analysis['metadata']['sheet_analysis_summary'] = [{
            'sheet_name': upload.uploaded_sheet_name or 'Unknown',
            'sheet_type': 'TRANSACTION',
            'raw_rows': total_products,
            'normalized_rows': total_products,
            'purchase_rows': 0,
            'sale_rows': total_products,
            'return_rows': 0,
            'unknown_rows': 0,
            'contributed_to_final_analysis': True,
        }]
    
    return analysis


def _sync_task_records_safe(upload, analysis):
    if not upload or not analysis or not isinstance(analysis, dict):
        return
    try:
        sync_task_records_for_upload(upload, analysis)
    except Exception as exc:
        logger.exception('Task record sync failed for upload %s: %s', upload.id, exc)


def _empty_analysis_payload(upload=None, analysis_error=None):
    return {
        'upload_id': getattr(upload, 'id', None),
        'sheet_id': getattr(upload, 'id', None),
        'file_name': getattr(upload, 'uploaded_sheet_name', None),
        'sheet_name': getattr(upload, 'uploaded_sheet_name', None),
        'row_count': 0,
        'status': getattr(upload, 'analysis_status', None),
        'analysis': None,
        'analysis_available': False,
        'analysis_error': analysis_error,
        'processing_summary': {},
        'processed_rows': 0,
    }


def _analysis_snapshot_has_usable_signal(snapshot):
    if not isinstance(snapshot, dict) or not snapshot:
        return False

    summary = snapshot.get('summary') if isinstance(snapshot.get('summary'), dict) else {}
    total_products = int(summary.get('total_products') or 0)
    status_total = int(summary.get('out_of_stock') or 0) + int(summary.get('low_stock') or 0) + int(summary.get('deadstock') or 0) + int(summary.get('overstock') or 0) + int(summary.get('healthy') or 0)
    if total_products > 0 or status_total > 0:
        return True

    metadata = snapshot.get('metadata') if isinstance(snapshot.get('metadata'), dict) else {}
    sheet_breakdown = metadata.get('sheet_breakdown') if isinstance(metadata.get('sheet_breakdown'), dict) else {}
    if int(sheet_breakdown.get('transaction') or 0) > 0:
        return True
    if int(sheet_breakdown.get('product_master') or 0) > 0:
        return True
    if int(sheet_breakdown.get('customer') or 0) > 0:
        return True

    sheet_analysis = snapshot.get('sheet_analysis') if isinstance(snapshot.get('sheet_analysis'), list) else []
    for row in sheet_analysis:
        if isinstance(row, dict) and row.get('contributed_to_final_analysis'):
            return True

    return False


def _persist_upload_raw_payload_resilient(upload, records):
    """Persist raw payload with compact fallback for oversized uploads."""
    records_safe = _to_json_db_safe(records)
    defaults = {
        'raw_data': records_safe,
        'processing_summary': {'payload_mode': 'full_raw', 'stored_row_count': len(records_safe) if isinstance(records_safe, list) else 0},
        'processed_rows': len(records_safe) if isinstance(records_safe, list) else 0,
        'last_processed_at': timezone.now(),
    }
    try:
        DataCleanerRunPayload.objects.update_or_create(run=upload, defaults=defaults)
        return
    except Exception as full_err:
        logger.warning('Raw payload full-save failed for upload %s, retrying compact mode: %s', upload.id, full_err)

    compact_rows = records_safe[: min(len(records_safe), 3000)] if isinstance(records_safe, list) else []
    DataCleanerRunPayload.objects.update_or_create(
        run=upload,
        defaults={
            'raw_data': compact_rows,
            'processing_summary': {
                'payload_mode': 'compact_raw_fallback',
                'original_row_count': len(records_safe) if isinstance(records_safe, list) else 0,
                'stored_row_count': len(compact_rows),
            },
            'processed_rows': len(compact_rows),
            'last_processed_at': timezone.now(),
            'error_log': ['Raw payload stored in compact mode due storage constraints.'],
        },
    )


class FileUploadView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        file = request.FILES.get('file')
        logger.info('🚀 FileUploadView.post() called by user=%s, file=%s', request.user.id, file)
        if not file:
            logger.warning('Upload failed: No file provided.')
            return Response({'error': 'No file provided in the request.'}, status=400)

        if file.size > 50 * 1024 * 1024:
            logger.warning('Upload failed: File %s too large (%s bytes).', file.name, file.size)
            return Response({'error': 'File is too large. Maximum size is 50MB.'}, status=400)

        file_type = file.name.split('.')[-1].lower()
        valid_extensions = ('csv', 'xlsx', 'xls', 'json')
        if file_type not in valid_extensions:
            logger.warning("Upload failed: Invalid type extension='%s'", file_type)
            return Response(
                {
                    'status': 'error',
                    'message': f'Invalid file format. Unsupported extension .{file_type}',
                },
                status=400,
            )

        try:
            content = file.read()
            logger.info('📖 Rapid Ingestion: Reading %s (%s bytes)', file.name, len(content))

            columns, records = process_file_data(content, file_type)
            logger.info('✅ Processed file: %d columns, %d records', len(columns), len(records))

            import pandas as pd

            try:
                df = pd.DataFrame(records)
                analyzer = AIAgentAnalyzer(df)
                mapping = analyzer._detect_schema()
            except Exception:
                mapping = detect_semantic_mapping(records)

            try:
                upload = DataCleanerRun.objects.create(
                    uploaded_by=request.user,
                    uploaded_sheet_name=file.name,
                    file_type=file_type,
                    analysis_status=DataCleanerRun.AnalysisStatus.PENDING,
                )
                logger.info('💾 Created DataCleanerRun id=%s for user=%s', upload.id, request.user.id)
                _persist_upload_raw_payload_resilient(upload, records)
                logger.info('✅ Created DataCleanerRunPayload for upload id=%s', upload.id)
            except OperationalError as create_err:
                if not _is_table_full_error(create_err):
                    raise
                reclaimed = _prune_upload_payloads(keep_latest=4)
                logger.warning('Upload table full; reclaimed=%s rows, retrying create.', reclaimed)
                upload = DataCleanerRun.objects.create(
                    uploaded_by=request.user,
                    uploaded_sheet_name=file.name,
                    file_type=file_type,
                    analysis_status=DataCleanerRun.AnalysisStatus.PENDING,
                )
                _persist_upload_raw_payload_resilient(upload, records)

            for attempt in range(3):
                try:
                    DataCleanerRun.objects.filter(
                        analysis_status__in=[DataCleanerRun.AnalysisStatus.PENDING, DataCleanerRun.AnalysisStatus.MAPPED],
                        id__lt=upload.id,
                    ).exclude(id=upload.id).update(
                        analysis_status=DataCleanerRun.AnalysisStatus.FAILED,
                    )
                    DataCleanerRunPayload.objects.filter(
                        run__id__lt=upload.id,
                        run__analysis_status=DataCleanerRun.AnalysisStatus.FAILED,
                    ).update(error_log=['Superseded by a newer sheet upload.'])
                    break
                except OperationalError as lock_err:
                    if attempt == 2:
                        logger.warning('Upload supersede skipped due lock timeout for upload=%s: %s', upload.id, lock_err)
                    else:
                        time.sleep(0.15 * (attempt + 1))

            logger.info('✅ Upload complete: id=%s, returning response', upload.id)
            return Response(
                {
                    'upload_id': upload.id,
                    'file_name': file.name,
                    'columns_detected': columns,
                    'suggested_mapping': mapping,
                    'row_count': len(records),
                    'preview': records[:50],
                    'full_data': records,
                    'status': upload.analysis_status,
                }
            )
        except ValueError as ve:
            logger.warning('File validation failed: %s', ve)
            return Response({'status': 'error', 'message': str(ve)}, status=400)
        except Exception as exc:
            logger.exception('❌ Unexpected data ingestion failure for %s: %s', file.name, exc)
            return Response({'status': 'error', 'message': f'System Failure: {str(exc)}'}, status=400)


class UploadListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        include_analysis = str(request.query_params.get('include_analysis', '')).lower() in {'1', 'true', 'yes'}
        limit_raw = request.query_params.get('limit')
        limit = 100
        if limit_raw:
            try:
                limit = max(1, min(200, int(limit_raw)))
            except (TypeError, ValueError):
                limit = 100

        run_ids = _recent_upload_ids_for_user(request.user, limit=limit)
        if not run_ids:
            return Response([])

        uploads = DataCleanerRun.objects.filter(id__in=run_ids).select_related('uploaded_by').order_by('-id')

        analysis_by_run = {}
        if include_analysis:
            payload_qs = DataCleanerRunPayload.objects.filter(run_id__in=run_ids).values('run_id', 'analysis_snapshot')
            for row in payload_qs:
                snapshot = row.get('analysis_snapshot')
                if isinstance(snapshot, dict):
                    analysis_by_run[row['run_id']] = {
                        'forecast_summary': snapshot.get('forecast_summary'),
                        'sales_summary': snapshot.get('sales_summary'),
                        'confidence_score': snapshot.get('confidence_score'),
                        'recommendations': snapshot.get('recommendations'),
                        'analysis_isolation': snapshot.get('analysis_isolation'),
                        'sheet_analysis': snapshot.get('sheet_analysis'),
                        'metadata': snapshot.get('metadata'),
                    }

        payload = []
        for upload in uploads:
            payload.append({
                'id': upload.id,
                'upload_id': upload.id,
                'sheet_id': upload.id,
                'file_name': upload.uploaded_sheet_name,
                'sheet_name': upload.uploaded_sheet_name,
                'file_type': upload.file_type,
                'analysis_status': upload.analysis_status,
                'status': upload.analysis_status,
                'completed_at': upload.completed_at,
                'uploaded_by_id': upload.uploaded_by_id,
                'uploaded_by__username': getattr(upload.uploaded_by, 'username', None),
                'analysis': analysis_by_run.get(upload.id),
            })
        return Response(payload)


class DataCleanerRunListView(generics.ListAPIView):
    serializer_class = DataCleanerRunSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        include_analysis = str(self.request.query_params.get('include_analysis', '')).lower() in {'1', 'true', 'yes'}
        ctx['include_analysis'] = include_analysis
        return ctx

    def get_queryset(self):
        limit_raw = self.request.query_params.get('limit')
        limit = 100
        if limit_raw:
            try:
                limit = max(1, min(200, int(limit_raw)))
            except (TypeError, ValueError):
                limit = 100

        include_analysis = str(self.request.query_params.get('include_analysis', '')).lower() in {'1', 'true', 'yes'}

        run_ids = _recent_upload_ids_for_user(self.request.user, limit=limit)
        if not run_ids:
            return DataCleanerRun.objects.none()

        qs = (
            DataCleanerRun.objects.filter(id__in=run_ids)
            .select_related('uploaded_by', 'payload')
            .defer('payload__raw_data')
            .order_by('-id')
        )
        if not include_analysis:
            qs = qs.defer('payload__analysis_snapshot')
        return qs


class LatestAnalysisView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        analysis_error = None
        try:
            # Keep candidate scan lightweight: do not pull JSON payload blobs for many rows.
            latest_runs = list(
                _uploads_for_user_or_legacy(request.user)
                .only('id', 'uploaded_sheet_name', 'analysis_status', 'uploaded_by_id')
                .order_by('-id')[:100]
            )
            if not latest_runs:
                return Response(_empty_analysis_payload())

            run_ids = [run.id for run in latest_runs]
            payload_meta = {}
            for meta in DataCleanerRunPayload.objects.filter(run_id__in=run_ids).only('run_id', 'processed_rows', 'processing_summary', 'analysis_snapshot'):
                summary = meta.processing_summary if isinstance(meta.processing_summary, dict) else {}
                snapshot = meta.analysis_snapshot if isinstance(meta.analysis_snapshot, dict) else {}
                payload_meta[meta.run_id] = {
                    'has_rows': bool(meta.processed_rows and meta.processed_rows > 0),
                    'has_snapshot': bool(snapshot),
                    'usable_snapshot': _analysis_snapshot_has_usable_signal(snapshot),
                    'invalid_reason': summary.get('invalid_reason'),
                }

            selected_run_id = None
            fallback_run_id = None
            for run in latest_runs:
                meta = payload_meta.get(run.id)
                if not meta:
                    continue
                if meta.get('usable_snapshot'):
                    selected_run_id = run.id
                    break
                if meta.get('has_snapshot') and not meta.get('usable_snapshot'):
                    continue
                if not meta.get('has_rows') and not meta.get('has_snapshot'):
                    continue
                if not meta.get('invalid_reason'):
                    selected_run_id = run.id
                    break
                if fallback_run_id is None:
                    fallback_run_id = run.id

            if selected_run_id is None:
                selected_run_id = fallback_run_id

            if selected_run_id is None:
                return Response(_empty_analysis_payload(analysis_error='No valid analysis result found. Please re-upload a clean file.'))

            latest_upload = (
                DataCleanerRun.objects
                .filter(id=selected_run_id)
                .select_related('payload')
                .only(
                    'id',
                    'uploaded_sheet_name',
                    'analysis_status',
                    'payload__run_id',
                    'payload__raw_data',
                    'payload__analysis_snapshot',
                    'payload__processing_summary',
                    'payload__processed_rows',
                )
                .first()
            )
            if not latest_upload:
                return Response(_empty_analysis_payload())

            payload_obj = getattr(latest_upload, 'payload', None)
            if not payload_obj:
                return Response(_empty_analysis_payload(upload=latest_upload))

            if not payload_obj.raw_data and not payload_obj.analysis_snapshot:
                return Response(_empty_analysis_payload(upload=latest_upload))

            cache_key = f'latest_analysis:{latest_upload.id}:{payload_obj.processed_rows}:{latest_upload.analysis_status}'
            cached_payload = cache.get(cache_key)
            if cached_payload:
                return Response(cached_payload)

            analysis = payload_obj.analysis_snapshot or None
            if analysis is None and payload_obj.raw_data and _can_attempt_analysis(latest_upload.analysis_status):
                if not payload_obj.raw_data:
                    return Response(_empty_analysis_payload(upload=latest_upload))

                try:
                    analysis = _generate_best_analysis_from_rows(payload_obj.raw_data)
                    payload_obj.analysis_snapshot = analysis
                    payload_obj.save(update_fields=['analysis_snapshot'])
                except ValueError:
                    return Response(_empty_analysis_payload(upload=latest_upload, analysis_error='Analysis generation failed'))
                except Exception as exc:
                    logger.exception('Latest analysis generation failed for upload %s: %s', latest_upload.id, exc)
                    analysis = None
                    analysis_error = 'Analysis generation failed'

            if payload_obj.raw_data and _rows_have_inventory_markers_simple(payload_obj.raw_data):
                if _analysis_needs_strict_refresh(analysis):
                    try:
                        refreshed = build_universal_analysis(payload_obj.raw_data)
                        if refreshed and isinstance(refreshed, dict):
                            analysis = refreshed
                            payload_obj.analysis_snapshot = analysis
                            payload_obj.save(update_fields=['analysis_snapshot'])
                    except Exception as exc:
                        logger.exception('Latest strict snapshot refresh failed for upload %s: %s', latest_upload.id, exc)

            # Existing legacy snapshots can carry non-business order quantities for strict inventory sheets.
            # Regenerate deterministically from raw rows when inventory markers are present.
            if analysis and payload_obj.raw_data and _rows_have_inventory_markers(payload_obj.raw_data):
                if not _is_deterministic_inventory_snapshot(analysis):
                    try:
                        refreshed = _generate_best_analysis_from_rows(payload_obj.raw_data)
                        if refreshed and isinstance(refreshed, dict):
                            analysis = refreshed
                            payload_obj.analysis_snapshot = analysis
                            payload_obj.save(update_fields=['analysis_snapshot'])
                    except Exception as exc:
                        logger.exception('Latest inventory snapshot refresh failed for upload %s: %s', latest_upload.id, exc)

            if analysis and isinstance(analysis, dict):
                if _is_flat_forecast(analysis.get('forecast', {}).get('next_365_days')) and payload_obj.raw_data:
                    try:
                        refreshed = _generate_best_analysis_from_rows(payload_obj.raw_data)
                        if refreshed and isinstance(refreshed, dict):
                            analysis = refreshed
                            payload_obj.analysis_snapshot = analysis
                            payload_obj.save(update_fields=['analysis_snapshot'])
                    except Exception as exc:
                        logger.exception('Latest analysis refresh failed for upload %s: %s', latest_upload.id, exc)

                analysis = _inject_sheet_metadata(analysis, latest_upload)
                analysis = json.loads(json.dumps(analysis, default=str))
                _sync_task_records_safe(latest_upload, analysis)

            processing_summary = json.loads(json.dumps(payload_obj.processing_summary, default=str))
            preview_rows = payload_obj.raw_data[:200] if payload_obj.raw_data else []
            preview_rows = json.loads(json.dumps(preview_rows, default=str))
            preview_columns = list(preview_rows[0].keys()) if preview_rows else []
            payload = {
                'upload_id': latest_upload.id,
                'sheet_id': latest_upload.id,
                'file_name': latest_upload.uploaded_sheet_name,
                'sheet_name': latest_upload.uploaded_sheet_name,
                'row_count': len(payload_obj.raw_data or []),
                'status': latest_upload.analysis_status,
                'analysis': analysis,
                'analysis_available': bool(analysis),
                'analysis_error': analysis_error,
                'processing_summary': processing_summary,
                'processed_rows': payload_obj.processed_rows,
                'preview_rows': preview_rows,
                'preview_columns': preview_columns,
            }
            cache.set(cache_key, payload, timeout=5)
            return Response(payload)
        except (OperationalError, InternalError, MemoryError) as exc:
            # Recover from transient MySQL memory/connection collapse without trapping UI in 500 loops.
            close_old_connections()
            connections.close_all()
            logger.exception('Latest analysis DB failure recovered with empty payload: %s', exc)
            return Response(_empty_analysis_payload(analysis_error='Database temporarily overloaded; try again.'))
        except Exception as exc:
            logger.exception('Latest analysis request failed: %s', exc)
            return Response({'error': 'Latest analysis failed', 'analysis_error': str(exc)}, status=500)


class UploadAnalysisView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, upload_id):
        analysis_error = None
        try:
            import pandas as pd

            upload = DataCleanerRun.objects.filter(id=upload_id).only(
                'id',
                'uploaded_sheet_name',
                'analysis_status',
                'completed_at',
                'uploaded_by_id',
            ).first()
            if not upload:
                return Response({'error': 'Upload not found'}, status=404)
            if not (request.user.is_superuser or request.user.is_staff) and upload.uploaded_by_id not in {request.user.id, None}:
                return Response({'error': 'Upload not found'}, status=404)
            payload_obj = getattr(upload, 'payload', None)
            if not payload_obj:
                return Response({'error': 'Data not available'}, status=404)

            if not payload_obj.raw_data and not payload_obj.analysis_snapshot:
                return Response({'error': 'Data not available'}, status=404)

            cache_key = f'upload_analysis:{upload.id}:{payload_obj.processed_rows}:{upload.analysis_status}'
            cached_payload = cache.get(cache_key)
            if cached_payload:
                return Response(cached_payload)

            analysis = payload_obj.analysis_snapshot or None
            if payload_obj.raw_data and _rows_have_inventory_markers_simple(payload_obj.raw_data):
                if _analysis_needs_strict_refresh(analysis):
                    try:
                        refreshed = build_universal_analysis(payload_obj.raw_data)
                        if refreshed and isinstance(refreshed, dict):
                            analysis = refreshed
                            payload_obj.analysis_snapshot = analysis
                            payload_obj.save(update_fields=['analysis_snapshot'])
                    except Exception as exc:
                        logger.exception('Upload strict snapshot refresh failed for upload %s: %s', upload.id, exc)

            if analysis and isinstance(analysis, dict):
                analysis = _inject_sheet_metadata(analysis, upload)
                analysis = json.loads(json.dumps(analysis, default=str))
                _sync_task_records_safe(upload, analysis)

            processing_summary = json.loads(json.dumps(payload_obj.processing_summary, default=str))
            preview_rows = payload_obj.raw_data[:200] if payload_obj.raw_data else []
            preview_rows = json.loads(json.dumps(preview_rows, default=str))
            preview_columns = list(preview_rows[0].keys()) if preview_rows else []
            payload = {
                'upload_id': upload.id,
                'sheet_id': upload.id,
                'file_name': upload.uploaded_sheet_name,
                'sheet_name': upload.uploaded_sheet_name,
                'row_count': len(payload_obj.raw_data or []),
                'status': upload.analysis_status,
                'analysis': analysis,
                'analysis_available': bool(analysis),
                'analysis_error': analysis_error,
                'processing_summary': processing_summary,
                'processed_rows': payload_obj.processed_rows,
                'preview_rows': preview_rows,
                'preview_columns': preview_columns,
            }
            cache.set(cache_key, payload, timeout=5)
            return Response(payload)
        except Exception as exc:
            logger.exception('Upload analysis request failed for upload %s: %s', upload_id, exc)
            return Response({'error': 'Upload analysis failed', 'analysis_error': str(exc)}, status=500)


class UploadSheetPreviewView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, upload_id):
        try:
            sheet_name = str(request.query_params.get('sheet_name') or '').strip()
            if not sheet_name:
                return Response({'error': 'sheet_name is required'}, status=400)
            search_query = str(request.query_params.get('search') or '').strip().lower()
            locate_batch = str(request.query_params.get('locate_batch') or '').strip().lower() in {'1', 'true', 'yes'}

            def _tokenize_search_part(value):
                tokens = []
                for match in re.finditer(r'"([^"]+)"|(\S+)', value or ''):
                    phrase = match.group(1)
                    single = match.group(2)
                    token = (phrase if phrase is not None else single) or ''
                    token = token.strip().lower()
                    if token:
                        tokens.append(token)
                return tokens

            search_groups = []
            if search_query:
                raw_groups = [part.strip() for part in search_query.split('|') if part.strip()]
                if not raw_groups:
                    raw_groups = [search_query]
                for part in raw_groups:
                    tokens = _tokenize_search_part(part)
                    if tokens:
                        search_groups.append(tokens)

            try:
                page = int(request.query_params.get('page', 1))
            except (TypeError, ValueError):
                page = 1
            try:
                page_size = int(request.query_params.get('page_size', 300))
            except (TypeError, ValueError):
                page_size = 300

            page = max(1, page)
            page_size = max(1, min(page_size, 1000))

            upload = DataCleanerRun.objects.filter(id=upload_id).only(
                'id',
                'uploaded_by_id',
                'uploaded_sheet_name',
                'analysis_status',
            ).first()
            if not upload:
                return Response({'error': 'Upload not found'}, status=404)
            if not (request.user.is_superuser or request.user.is_staff) and upload.uploaded_by_id not in {request.user.id, None}:
                return Response({'error': 'Upload not found'}, status=404)

            payload_obj = getattr(upload, 'payload', None)
            rows = payload_obj.raw_data if payload_obj and isinstance(payload_obj.raw_data, list) else []
            if not rows:
                return Response({'error': 'Data not available'}, status=404)

            matched_rows = []
            for row in rows:
                if not isinstance(row, dict):
                    continue
                row_sheet_name = str(row.get('_sheet_name') or '').strip()
                if row_sheet_name == sheet_name:
                    matched_rows.append(row)

            def _row_matches_query(row):
                if not search_query:
                    return True
                if not isinstance(row, dict):
                    return False
                def _normalize_text(value):
                    raw = str(value or '').strip().lower()
                    compact = re.sub(r'[^a-z0-9]+', ' ', raw).strip()
                    return raw, compact

                def _expand_date_tokens(token):
                    expanded = {token}
                    normalized = token.replace('/', '-').replace('.', '-').strip()
                    if normalized:
                        expanded.add(normalized)
                    parsed = pd.to_datetime(normalized, errors='coerce', dayfirst=True)
                    if pd.isna(parsed):
                        parsed = pd.to_datetime(normalized, errors='coerce', dayfirst=False)
                    if not pd.isna(parsed):
                        expanded.add(parsed.strftime('%Y-%m-%d').lower())
                        expanded.add(parsed.strftime('%d-%m-%Y').lower())
                        expanded.add(parsed.strftime('%d/%m/%Y').lower())
                        expanded.add(parsed.strftime('%Y/%m/%d').lower())
                    return {item for item in expanded if item}

                value_blobs = []
                for value in row.values():
                    raw, compact = _normalize_text(value)
                    if raw:
                        value_blobs.append(raw)
                    if compact:
                        value_blobs.append(compact)

                if search_groups:
                    for group in search_groups:
                        group_ok = True
                        for term in group:
                            term_variants = _expand_date_tokens(term)
                            term_hit = any(any(variant in blob for variant in term_variants) for blob in value_blobs)
                            if not term_hit:
                                group_ok = False
                                break
                        if group_ok:
                            return True
                    return False

                fallback_variants = _expand_date_tokens(search_query)
                return any(any(variant in blob for variant in fallback_variants) for blob in value_blobs)

            if not matched_rows:
                snapshot = payload_obj.analysis_snapshot if payload_obj and isinstance(payload_obj.analysis_snapshot, dict) else {}
                metadata = snapshot.get('metadata') if isinstance(snapshot.get('metadata'), dict) else {}
                previews = metadata.get('sheet_previews') if isinstance(metadata.get('sheet_previews'), list) else []
                preview_item = next(
                    (
                        p for p in previews
                        if isinstance(p, dict) and str(p.get('sheet_name') or '').strip() == sheet_name
                    ),
                    None,
                )
                if preview_item:
                    preview_rows = preview_item.get('rows') if isinstance(preview_item.get('rows'), list) else []
                    total_rows = int(preview_item.get('total_rows') or len(preview_rows))
                    search_matches = None
                    if search_query:
                        filtered = [r for r in preview_rows if _row_matches_query(r)]
                        search_matches = len(filtered)
                        preview_rows = filtered
                        total_rows = len(preview_rows)
                    total_pages = max(1, (total_rows + page_size - 1) // page_size)
                    if page > total_pages:
                        page = total_pages
                    start_idx = (page - 1) * page_size
                    end_idx = start_idx + page_size
                    preview_rows = preview_rows[start_idx:end_idx]
                    safe_rows = json.loads(json.dumps(preview_rows, default=str))
                    columns = list(safe_rows[0].keys()) if safe_rows else []
                    return Response({
                        'upload_id': upload.id,
                        'sheet_name': sheet_name,
                        'page': page,
                        'page_size': page_size,
                        'total_rows': total_rows,
                        'total_pages': total_pages,
                        'returned_rows': len(safe_rows),
                        'has_next': page < total_pages,
                        'has_prev': page > 1,
                        'columns': columns,
                        'search_matches': search_matches,
                        'rows': safe_rows,
                    })

            all_rows = matched_rows
            search_matches = None
            if search_query:
                matching_indexes = [idx for idx, row in enumerate(all_rows) if _row_matches_query(row)]
                search_matches = len(matching_indexes)
                matched_rows = [r for r in all_rows if _row_matches_query(r)]
                if locate_batch:
                    page = 1

            total_rows = len(matched_rows)
            total_pages = max(1, (total_rows + page_size - 1) // page_size)
            if page > total_pages:
                page = total_pages

            start_idx = (page - 1) * page_size
            end_idx = start_idx + page_size
            page_rows = matched_rows[start_idx:end_idx]

            safe_rows = json.loads(json.dumps(page_rows, default=str))
            columns = list(safe_rows[0].keys()) if safe_rows else []

            return Response({
                'upload_id': upload.id,
                'sheet_name': sheet_name,
                'page': page,
                'page_size': page_size,
                'total_rows': total_rows,
                'total_pages': total_pages,
                'returned_rows': len(safe_rows),
                'has_next': page < total_pages,
                'has_prev': page > 1,
                'columns': columns,
                'search_matches': search_matches,
                'rows': safe_rows,
            })
        except Exception as exc:
            logger.exception('Upload sheet preview failed for upload %s: %s', upload_id, exc)
            return Response({'error': 'Upload sheet preview failed', 'detail': str(exc)}, status=500)


class UploadLedgerRiskSummaryView(APIView):
    """
    Deterministic ledger risk summary (OUT/LOW/HEALTHY) computed from raw upload rows.

    This endpoint exists to keep frontend stats stable and prevent drift between
    different analysis snapshots (e.g., check-quantity vs ledger movement).
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, upload_id):
        try:
            sheet_name = str(request.query_params.get('sheet_name') or '').strip() or None

            upload = DataCleanerRun.objects.filter(id=upload_id).only(
                'id',
                'uploaded_by_id',
                'uploaded_sheet_name',
                'analysis_status',
            ).first()
            if not upload:
                return Response({'error': 'Upload not found'}, status=404)
            if not (request.user.is_superuser or request.user.is_staff) and upload.uploaded_by_id not in {request.user.id, None}:
                return Response({'error': 'Upload not found'}, status=404)

            payload_obj = getattr(upload, 'payload', None)
            rows = payload_obj.raw_data if payload_obj and isinstance(payload_obj.raw_data, list) else []
            if not rows:
                return Response({'error': 'Data not available'}, status=404)

            # Infer sheet_name from first row if not provided.
            if not sheet_name:
                for row in rows:
                    if isinstance(row, dict):
                        sheet_name = str(row.get('_sheet_name') or '').strip() or None
                        if sheet_name:
                            break

            if not sheet_name:
                return Response({'error': 'sheet_name is required'}, status=400)

            def _to_num(value):
                try:
                    if value is None:
                        return None
                    if isinstance(value, str):
                        raw = value.strip()
                        if not raw or raw.lower() == 'nan':
                            return None
                        return float(raw)
                    return float(value)
                except (TypeError, ValueError):
                    return None

            def _norm_key(value):
                return re.sub(r'[^a-z0-9]+', '', str(value or '').lower())

            def _get(row, aliases):
                alias = {_norm_key(a) for a in aliases}
                for key, val in row.items():
                    if _norm_key(key) in alias:
                        if val is None:
                            continue
                        if isinstance(val, str) and (not val.strip() or val.strip().lower() == 'nan'):
                            continue
                        return val
                return None

            product_aliases = ['product', 'product_name', 'name', 'item']
            direction_aliases = ['in/out', 'in_out', 'inout', 'type', 'movement']
            qty_aliases = ['quantity', 'qty', 'units']

            buckets = {}
            for idx, row in enumerate(rows):
                if not isinstance(row, dict):
                    continue
                if str(row.get('_sheet_name') or '').strip() != sheet_name:
                    continue

                product = str(_get(row, product_aliases) or '').strip()
                if not product:
                    continue

                direction_raw = str(_get(row, direction_aliases) or '').strip().upper()
                qty_raw = _to_num(_get(row, qty_aliases))
                if qty_raw is None:
                    continue
                qty = abs(qty_raw)

                if product not in buckets:
                    buckets[product] = {'in': 0.0, 'out': 0.0, 'ret': 0.0}

                if 'RETURN' in direction_raw or direction_raw == 'RET':
                    buckets[product]['ret'] += qty
                elif 'OUT' in direction_raw or 'SALE' in direction_raw or 'ISSUE' in direction_raw:
                    buckets[product]['out'] += qty
                elif 'IN' in direction_raw or 'PURCHASE' in direction_raw or 'RECEIPT' in direction_raw:
                    buckets[product]['in'] += qty

            threshold = 10.0
            out_count = 0
            low_count = 0
            healthy_count = 0
            for bucket in buckets.values():
                net = bucket['in'] + bucket['ret'] - bucket['out']
                if net <= 0:
                    out_count += 1
                elif net < threshold:
                    low_count += 1
                else:
                    healthy_count += 1

            return Response({
                'upload_id': upload.id,
                'sheet_name': sheet_name,
                'total_products': len(buckets),
                'threshold': threshold,
                'out_of_stock': out_count,
                'low_stock': low_count,
                'healthy': healthy_count,
                'deadstock': 0,
                'overstock': 0,
            })
        except Exception as exc:
            logger.exception('Upload ledger risk summary failed for upload %s: %s', upload_id, exc)
            return Response({'error': 'Upload ledger risk summary failed', 'detail': str(exc)}, status=500)


class SheetListCreateView(generics.ListCreateAPIView):
    serializer_class = SheetSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Sheet.objects.filter(created_by=self.request.user).order_by('-updated_at')

    def perform_create(self, serializer):
        serializer.save(
            created_by=self.request.user,
            sheet_size=_compute_sheet_size_from_payload(self.request.data),
        )


class SheetDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = SheetSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Sheet.objects.filter(created_by=self.request.user)

    def perform_update(self, serializer):
        before = self.get_object()
        before_status = before.status
        instance = serializer.save(sheet_size=_compute_sheet_size_from_payload(self.request.data))

        if instance.status == Sheet.Status.DELETE:
            RecycleBinSheet.objects.update_or_create(
                sheet=instance,
                defaults={
                    'sheet_id_snapshot': instance.id,
                    'sheet_name': instance.name,
                    'action': RecycleBinSheet.Action.DELETE,
                    'action_by': self.request.user,
                    'restored_at': None,
                },
            )
        elif before_status == Sheet.Status.DELETE and instance.status in {Sheet.Status.DRAFT, Sheet.Status.RESTORE, Sheet.Status.PUBLISHED}:
            RecycleBinSheet.objects.update_or_create(
                sheet=instance,
                defaults={
                    'sheet_id_snapshot': instance.id,
                    'sheet_name': instance.name,
                    'action': RecycleBinSheet.Action.RESTORE,
                    'action_by': self.request.user,
                    'restored_at': timezone.now(),
                },
            )

    def perform_destroy(self, instance):
        # Permanent delete path: if sheet is already archived, remove it physically.
        if instance.status == Sheet.Status.DELETE:
            recycle_record = RecycleBinSheet.objects.filter(sheet=instance).first()
            if recycle_record:
                recycle_record.sheet_id_snapshot = instance.id
                recycle_record.sheet_name = instance.name
                recycle_record.sheet = None
                recycle_record.action = RecycleBinSheet.Action.DELETE
                recycle_record.action_by = self.request.user
                recycle_record.restored_at = None
                recycle_record.save(update_fields=['sheet_id_snapshot', 'sheet_name', 'sheet', 'action', 'action_by', 'restored_at'])
            else:
                RecycleBinSheet.objects.create(
                    sheet=None,
                    sheet_id_snapshot=instance.id,
                    sheet_name=instance.name,
                    action=RecycleBinSheet.Action.DELETE,
                    action_by=self.request.user,
                    restored_at=None,
                )
            instance.delete()
            return

        # Default delete path: soft-delete by moving to recycle bin.
        instance.status = Sheet.Status.DELETE
        instance.save(update_fields=['status', 'updated_at'])
        RecycleBinSheet.objects.update_or_create(
            sheet=instance,
            defaults={
                'sheet_id_snapshot': instance.id,
                'sheet_name': instance.name,
                'action': RecycleBinSheet.Action.DELETE,
                'action_by': self.request.user,
                'restored_at': None,
            },
        )


class RecycleBinListView(generics.ListAPIView):
    serializer_class = RecycleBinSheetSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return RecycleBinSheet.objects.filter(
            Q(sheet__created_by=self.request.user) |
            Q(sheet__isnull=True, action_by=self.request.user)
        ).order_by('-deleted_at')


class RecycleBinRestoreView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        record = RecycleBinSheet.objects.filter(pk=pk).filter(
            Q(sheet__created_by=request.user) |
            Q(sheet__isnull=True, action_by=request.user)
        ).first()
        if not record:
            return Response({'error': 'Recycle bin item not found'}, status=404)
        if not record.sheet:
            return Response({'error': 'Sheet no longer exists. Restore is not possible.'}, status=400)

        record.sheet.status = Sheet.Status.RESTORE
        record.sheet.save(update_fields=['status', 'updated_at'])
        if record.sheet_id:
            record.sheet_id_snapshot = record.sheet_id
        record.action = RecycleBinSheet.Action.RESTORE
        record.action_by = request.user
        record.restored_at = timezone.now()
        record.save(update_fields=['sheet_id_snapshot', 'action', 'action_by', 'restored_at'])
        return Response({'status': 'success', 'message': 'Sheet restored'})


class RecycleBinPermanentDeleteView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        record = RecycleBinSheet.objects.filter(pk=pk).filter(
            Q(sheet__created_by=request.user) |
            Q(sheet__isnull=True, action_by=request.user)
        ).select_related('sheet').first()
        if not record:
            # Fallback: allow hard-delete by sheet id and preserve recycle history.
            sheet = Sheet.objects.filter(
                pk=pk,
                created_by=request.user,
            ).first()
            if not sheet:
                return Response({'error': 'Recycle bin item not found'}, status=404)

            fallback_record = RecycleBinSheet.objects.filter(sheet=sheet).first()
            if fallback_record:
                fallback_record.sheet_id_snapshot = sheet.id
                fallback_record.sheet_name = sheet.name
                fallback_record.sheet = None
                fallback_record.action = RecycleBinSheet.Action.DELETE
                fallback_record.action_by = request.user
                fallback_record.restored_at = None
                fallback_record.save(update_fields=['sheet_id_snapshot', 'sheet_name', 'sheet', 'action', 'action_by', 'restored_at'])
            else:
                RecycleBinSheet.objects.create(
                    sheet=None,
                    sheet_id_snapshot=sheet.id,
                    sheet_name=sheet.name,
                    action=RecycleBinSheet.Action.DELETE,
                    action_by=request.user,
                    restored_at=None,
                )
            sheet.delete()
            return Response({'status': 'success', 'message': 'Sheet permanently deleted'}, status=200)

        sheet = record.sheet
        if not sheet:
            return Response({'status': 'success', 'message': 'Sheet permanently deleted'}, status=200)

        record.sheet_id_snapshot = sheet.id
        record.sheet_name = sheet.name
        record.sheet = None
        record.action = RecycleBinSheet.Action.DELETE
        record.action_by = request.user
        record.restored_at = None
        record.save(update_fields=['sheet_id_snapshot', 'sheet_name', 'sheet', 'action', 'action_by', 'restored_at'])
        sheet.delete()
        return Response({'status': 'success', 'message': 'Sheet permanently deleted'}, status=200)


class SheetAiGenerateView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        prompt = request.data.get('prompt')
        attached_file = request.FILES.get('file')

        if not prompt and not attached_file:
            return Response({'error': 'No architectural instructions or physical assets provided'}, status=400)

        if not genai or not types:
            return Response({'error': 'Google GenAI SDK is not available. Install google-genai package.'}, status=503)

        if not os.getenv('GEMINI_API_KEY'):
            return Response({'error': 'GEMINI_API_KEY is not configured.'}, status=503)

        client = genai.Client(api_key=os.getenv('GEMINI_API_KEY'))
        system_instructions = """
        You are a Data Architect and Multimodal Analyst.
        TASK: Generate a realistic, structured JSON dataset for a business spreadsheet.

        ALGORITHM:
        1. If a file (image/chart/doc) is provided, intelligently extract its headers, data types, and values.
        2. If only a prompt is provided, synthesize the data architecturally.
        3. RESPECT SCALE: Follow the specific row count requested in the User Request (e.g., 5, 50, 100 rows).
           If no count is specified, generate a professional sample of 25 rows.
        4. Deliver HIGH-ACCURACY, DEPENDABLE results.
        5. Return ONLY valid JSON with keys "columns" (list of objects) and "data" (list of objects).

        JSON SCHEMA:
        - "columns": [{"name": "Header", "type": "text|number|date|currency|dropdown", "options": []}]
        - "data": List of matching rows.
        """

        contents = [system_instructions]
        if prompt:
            contents.append(f'User Request: {prompt}')

        if attached_file:
            file_bytes = attached_file.read()
            mime_type = attached_file.content_type
            contents.append(types.Part.from_bytes(data=file_bytes, mime_type=mime_type))

        try:
            response = client.models.generate_content(
                model='gemini-2.0-flash',
                contents=contents,
                config=types.GenerateContentConfig(response_mime_type='application/json'),
            )

            res_text = response.text.strip()
            if res_text.startswith('```json'):
                res_text = res_text[7:-3].strip()

            generated_data = json.loads(res_text)
            return Response(
                {
                    'status': 'success',
                    'columns': generated_data.get('columns', []),
                    'data': generated_data.get('data', []),
                }
            )
        except Exception as exc:
            error_str = str(exc)
            if '429' in error_str or 'RESOURCE_EXHAUSTED' in error_str:
                return Response({'error': 'NEURAL_QUOTA_EXHAUSTED', 'retry_after': 60}, status=429)
            logger.error('AI Multimodal Synthesis Error: %s', error_str)
            return Response({'error': f'Architectural Failure: {error_str}'}, status=500)


class EventStreamRenderer(BaseRenderer):
    media_type = 'text/event-stream'
    format = 'txt'

    def render(self, data, accepted_media_type=None, renderer_context=None):
        return data
class SimpleCountView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        """Simple test to see if database has any uploads at all."""
        total = DataCleanerRun.objects.all().count()
        user_count = DataCleanerRun.objects.filter(uploaded_by=request.user).count()
        
        logger.info('SimpleCountView: total=%d, user=%d (id=%s)', total, user_count, request.user.id)
        
        # Also get a sample to see what's there
        sample = list(DataCleanerRun.objects.all()[:1].values('id', 'uploaded_sheet_name', 'uploaded_by__username', 'analysis_status'))
        
        return Response({
            'total_count': total,
            'your_count': user_count,
            'user_id': request.user.id,
            'sample': sample,
            'message': f'Database has {total} total uploads, you have {user_count}'
        })


class DebugUploadsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        """Debug endpoint to check what's in the database."""
        user = request.user
        
        # Get all uploads
        all_uploads = DataCleanerRun.objects.all().count()
        
        # Get user's uploads
        user_uploads = DataCleanerRun.objects.filter(uploaded_by=user).count()
        
        # Get uploads using helper
        helper_uploads = _uploads_for_user_or_legacy(user).count()
        
        # Get sample data
        samples = list(DataCleanerRun.objects.all()[:5].values('id', 'uploaded_sheet_name', 'uploaded_by_id', 'uploaded_by__username', 'analysis_status', 'completed_at'))
        
        return Response({
            'total_uploads_in_db': all_uploads,
            'user_id': user.id,
            'user_username': user.username,
            'is_staff': user.is_staff,
            'is_superuser': user.is_superuser,
            'user_uploads_count': user_uploads,
            'helper_filtered_count': helper_uploads,
            'sample_uploads': samples,
        })


class ProcessStreamView(APIView):
    """
    Server-Sent Events (SSE) endpoint for row-by-row AI data processing.
    """
    permission_classes = [AllowAny]
    renderer_classes = [EventStreamRenderer] # Avoids 406 Not Acceptable

    def options(self, request, *args, **kwargs):
        response = StreamingHttpResponse('')
        origin = request.headers.get('Origin')
        if origin:
            response['Access-Control-Allow-Origin'] = origin
            response['Vary'] = 'Origin'
        response['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
        response['Access-Control-Allow-Headers'] = 'Authorization, Content-Type'
        return response

    def get(self, request, upload_id):
        upload_obj = None
        # 0. Handle Token in Query Param (for EventSource compatibility)
        token = request.query_params.get('token')
        if token and not request.user.is_authenticated:
            from rest_framework_simplejwt.tokens import AccessToken
            try:
                access_token = AccessToken(token)
                from django.contrib.auth.models import User
                user_id = access_token.get('user_id')
                user = User.objects.get(id=user_id)
                request.user = user
                logger.info(f"Authenticated via query token for User: {user.username}")
            except Exception as te:
                logger.error(f"SSE Auth Failure: {te}")
                return StreamingHttpResponse("Unauthorized", status=401)

        try:
            # 1. Fetch file record
            if not request.user.is_authenticated:
                 return StreamingHttpResponse("Unauthorized", status=401)
            
            upload_obj = DataCleanerRun.objects.filter(
                id=upload_id,
                uploaded_by=request.user,
            ).first()
            if not upload_obj:
                logger.error(f"ProcessStreamView: File {upload_id} not accessible for user {request.user.id}.")
                return StreamingHttpResponse("File not found.", status=404)

            if upload_obj.analysis_status == DataCleanerRun.AnalysisStatus.PROCESSING:
                logger.warning(
                    "ProcessStreamView: Upload %s is already processing; rejecting concurrent stream.",
                    upload_obj.pk,
                )
                return StreamingHttpResponse(
                    "This upload is already being processed. Please wait for completion.",
                    status=409
                )

            try:
                latest_obj = DataCleanerRun.objects.only('id').filter(uploaded_by=request.user).order_by('-id').first()
                latest_upload_id = latest_obj.id if latest_obj else None
            except DataCleanerRun.DoesNotExist:
                latest_upload_id = None
            if latest_upload_id and int(upload_id) != int(latest_upload_id):
                logger.warning(
                    f"ProcessStreamView: Rejected stale upload {upload_id}; latest upload is {latest_upload_id}."
                )
                return StreamingHttpResponse(
                    "This upload has been superseded by a newer sheet. Please process the latest upload.",
                    status=409
                )
            
            # 2. Extract data (convert raw_data JSON back to DataFrame)
            payload_obj = getattr(upload_obj, 'payload', None)
            if not payload_obj or not payload_obj.raw_data:
                return StreamingHttpResponse("No data found to process.", status=400)

            confirm_reanalysis = str(request.query_params.get('confirm_reanalysis', '')).strip().lower() in {
                '1',
                'true',
                'yes',
            }
            is_reanalysis = upload_obj.analysis_status in {
                DataCleanerRun.AnalysisStatus.COMPLETED,
                DataCleanerRun.AnalysisStatus.SUCCESS,
                # DataCleanerRun.AnalysisStatus.FAILED removed: failed runs should not block a fresh start.
                DataCleanerRun.AnalysisStatus.REANALYSIS,
            }
            if is_reanalysis and not confirm_reanalysis:
                return StreamingHttpResponse(
                    'Re-analysis requires confirmation. Pass confirm_reanalysis=true to continue.',
                    status=409,
                )
            if is_reanalysis:
                upload_obj.analysis_status = DataCleanerRun.AnalysisStatus.REANALYSIS
                upload_obj.save(update_fields=['analysis_status'])
            
            df = pd.DataFrame(payload_obj.raw_data)
            
            # 3. Mark as processing with retry to survive temporary lock contention.
            marked_processing = False
            for attempt in range(3):
                try:
                    DataCleanerRun.objects.filter(pk=upload_obj.pk).update(
                        analysis_status=DataCleanerRun.AnalysisStatus.REANALYSIS if is_reanalysis else DataCleanerRun.AnalysisStatus.PROCESSING,
                    )
                    marked_processing = True
                    break
                except OperationalError as lock_err:
                    if attempt == 2:
                        logger.warning(
                            "Could not mark upload %s as PROCESSING due lock timeout: %s",
                            upload_obj.pk,
                            lock_err,
                        )
                    else:
                        time.sleep(0.15 * (attempt + 1))

            if not marked_processing:
                logger.info("Proceeding with stream for upload %s without immediate PROCESSING mark.", upload_obj.pk)
            upload_obj.analysis_status = DataCleanerRun.AnalysisStatus.REANALYSIS if is_reanalysis else DataCleanerRun.AnalysisStatus.PROCESSING
            
            # 4. Initialize DataProcessingService
            service = DataProcessingService(upload_obj, df)
            
            # 5. Return Streaming Response
            response = StreamingHttpResponse(
                service.run_generator(),
                content_type='text/event-stream'
            )
            response['Cache-Control'] = 'no-cache'
            response['X-Accel-Buffering'] = 'no' # Disable buffering for Nginx
            origin = request.headers.get('Origin')
            if origin:
                response['Access-Control-Allow-Origin'] = origin
                response['Vary'] = 'Origin'
            return response

        except Exception as e:
            logger.exception(f"Critical error in ProcessStreamView: {e}")
            if upload_obj is not None:
                try:
                    DataCleanerRun.objects.filter(pk=upload_obj.pk).update(
                        analysis_status=DataCleanerRun.AnalysisStatus.FAILED,
                    )
                    if payload_obj:
                        payload_obj.error_log = [str(e)]
                        payload_obj.save(update_fields=['error_log'])
                except Exception:
                    logger.exception('Failed to mark upload %s as FAILED after stream error.', upload_obj.pk)
            return StreamingHttpResponse(
                json.dumps({"error": str(e), "status": "failed"}), 
                status=500, 
                content_type='application/json'
            )
