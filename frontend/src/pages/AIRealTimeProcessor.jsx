import React, { useState, useRef, useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Loader2 } from 'lucide-react';
import api from '../api/client';
import { getApiBaseUrl } from '../api/client';
import EnterpriseNeuralResult from '../components/AIProcessor/EnterpriseResultSlide';
import { useAnalysis } from '../context/useAnalysis';
import { useTheme } from '../context/ThemeContext';
import { useLayoutFullscreen } from '../context/LayoutContext';
import ProcessorHeader from '../features/ai-processor/components/ProcessorHeader';
import AnalysisSummaryPanel from '../features/ai-processor/components/AnalysisSummaryPanel';
import ProcessorMainSection from '../features/ai-processor/components/ProcessorMainSection';
import ProcessingStatusFooter from '../features/ai-processor/components/ProcessingStatusFooter';
import {
  deriveStatsFromAnalysis,
  buildLocalAnalysisFromRows,
  buildAnalysisFromSummary,
  tagAnalysisWithSession,
  getPhaseFromProgress,
  deriveUnifiedRiskCounts,
  deriveSalesTotalFromAnalysis,
} from '../features/ai-processor/utils/analysisHelpers';
import {
  buildCsvString,
  buildFinalizeLogs,
  buildInitialLogsAfterAnalysis,
  buildMockedRowsFromProducts,
  buildPendingRows,
  buildStartProcessingLogs,
  buildStatsFromAnalysisSummary,
  getDynamicStatusText,
} from '../features/ai-processor/process/analysisSteps';

const PROCESSOR_LOCKED_ANALYSIS_KEY = 'ai-ops-processor-locked-analysis';
const hasMeaningfulAnalysisSnapshot = (analysisPayload) => {
  if (!analysisPayload || typeof analysisPayload !== 'object') return false;
  const confidence = Number(analysisPayload?.confidence_score || 0);
  const hasDiagnostics = Array.isArray(analysisPayload?.metadata?.sheet_diagnostics) && analysisPayload.metadata.sheet_diagnostics.length > 0;
  const hasIngestionReport = Array.isArray(analysisPayload?.metadata?.ingestion_report) && analysisPayload.metadata.ingestion_report.length > 0;
  const hasRecommendations = Array.isArray(analysisPayload?.recommendations) && analysisPayload.recommendations.length > 0;
  const hasAlerts = Array.isArray(analysisPayload?.alerts) && analysisPayload.alerts.length > 0;
  const salesTotal = deriveSalesTotalFromAnalysis(analysisPayload, []);
  return confidence > 0 && (hasDiagnostics || hasIngestionReport || hasRecommendations || hasAlerts || salesTotal > 0);
};

const readLockedProcessorAnalysis = () => {
  try {
    const raw = localStorage.getItem(PROCESSOR_LOCKED_ANALYSIS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return hasMeaningfulAnalysisSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const resolveAnalysisUploadId = (analysisPayload) => {
  const parsed = Number(
    analysisPayload?.analysis_isolation?.sheet_id
    || analysisPayload?.analysis_isolation?.upload_id
    || analysisPayload?.metadata?.upload_id
    || 0
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const AIRealTimeProcessor = () => {
  const {
    analysis: sharedAnalysis,
    setAnalysis,
    pinUploadAnalysis,
    clearPinnedUploadAnalysis,
  } = useAnalysis();
  const { theme } = useTheme();
  const { isLayoutFullscreen, toggleFullscreen } = useLayoutFullscreen();
  const isLight = theme === 'light';
  const skipProcessingAnimation = false;
  const bootLockedAnalysis = useMemo(() => readLockedProcessorAnalysis(), []);
  const [file, setFile] = useState(null);
  const [uploadId, setUploadId] = useState(() => resolveAnalysisUploadId(bootLockedAnalysis));
  const [data, setData] = useState([]);
  const [columns, setColumns] = useState([]);
  const [status, setStatus] = useState(() => (bootLockedAnalysis ? 'READY' : 'IDLE')); // IDLE, UPLOADING, READY, PROCESSING, COMPLETED
  const [processingIdx, setProcessingIdx] = useState(null);
  const [progressPct, setProgressPct] = useState(0);
  const [logs, setLogs] = useState([]);
  const [hybridResult, setHybridResult] = useState(() => bootLockedAnalysis);
  const [showResultSlide, setShowResultSlide] = useState(false);
  const [isNeuralCooldown, setIsNeuralCooldown] = useState(false);
  const [isLockedSnapshotActive, setIsLockedSnapshotActive] = useState(() => Boolean(bootLockedAnalysis));
  const [phaseLabel, setPhaseLabel] = useState('Data Cleaning');
  const [phaseMessage, setPhaseMessage] = useState('Crunching data vectors...');
  const [telemetry, setTelemetry] = useState({
    etaSeconds: 0,
    recordsPerSecond: 0,
    anomaliesDetected: 0,
  });
  const [displayProgressPct, setDisplayProgressPct] = useState(0);
  const [processingSnapshot, setProcessingSnapshot] = useState({ processed: 0, total: 0 });
  const [showCompletionHold, setShowCompletionHold] = useState(false);
  const [showReanalysisConfirm, setShowReanalysisConfirm] = useState(false);
  const [showDuplicateConfirm, setShowDuplicateConfirm] = useState(false);
  const [duplicateInfo, setDuplicateInfo] = useState(null);
  const [pendingUploadFile, setPendingUploadFile] = useState(null);
  const [isReanalysisMode, setIsReanalysisMode] = useState(false);
  const [sheetViewKey, setSheetViewKey] = useState('analysis');
  const [sheetClassFilter, setSheetClassFilter] = useState('ALL');
  const [tableSearchQuery, setTableSearchQuery] = useState('');
  const [tableSearchField, setTableSearchField] = useState('ALL');
  const [tableSearchMode, setTableSearchMode] = useState('contains');
  const [tableStatusFilter, setTableStatusFilter] = useState('ALL');
  const [tableBusinessFilter, setTableBusinessFilter] = useState('ALL');
  const [sheetPreviewPage, setSheetPreviewPage] = useState(1);
  const [sheetPreviewRows, setSheetPreviewRows] = useState([]);
  const [sheetPreviewTotalRows, setSheetPreviewTotalRows] = useState(null);
  const [sheetPreviewRowsLoading, setSheetPreviewRowsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(() => (
    bootLockedAnalysis
      ? deriveStatsFromAnalysis(bootLockedAnalysis)
      : { anomalies: 0, cleaned: 0, predictions: 0, verified: 0 }
  ));
  const fileInputRef = useRef(null);
  const newSheetInputRef = useRef(null);
  const eventSourceRef = useRef(null);
  const resultSlideTimeoutRef = useRef(null);
  const completionTransitionTimeoutRef = useRef(null);
  const playbackIntervalRef = useRef(null);
  const backendRowsRef = useRef([]);
  const latestSummaryRef = useRef({});
  const totalRowsRef = useRef(0);
  const lastProgressSignalRef = useRef(Date.now());

  const clearPlaybackInterval = () => {
    if (playbackIntervalRef.current) {
      clearInterval(playbackIntervalRef.current);
      playbackIntervalRef.current = null;
    }
  };

  const clearCompletionTransitionTimeout = () => {
    if (completionTransitionTimeoutRef.current) {
      clearTimeout(completionTransitionTimeoutRef.current);
      completionTransitionTimeoutRef.current = null;
    }
  };

  const computeFileHash = async (selectedFile) => {
    if (!selectedFile || !window.crypto?.subtle) {
      return null;
    }
    try {
      const buffer = await selectedFile.arrayBuffer();
      const digest = await window.crypto.subtle.digest('SHA-256', buffer);
      const hashArray = Array.from(new Uint8Array(digest));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch (err) {
      console.warn('Hash compute failed, skipping duplicate check.', err);
      return null;
    }
  };

  const getAnalysisSessionKey = (analysisPayload) => {
    if (!analysisPayload || typeof analysisPayload !== 'object') return 'none';
    const isolation = analysisPayload.analysis_isolation || {};
    return String(
      isolation.session_id
      || isolation.sheet_id
      || isolation.upload_id
      || analysisPayload.metadata?.upload_id
      || 'none'
    );
  };

  useEffect(() => {
    if (!bootLockedAnalysis) return;
    const lockedUploadId = resolveAnalysisUploadId(bootLockedAnalysis);
    if (lockedUploadId) {
      pinUploadAnalysis(lockedUploadId);
    }
    setAnalysis(bootLockedAnalysis);
    setIsLockedSnapshotActive(true);
  }, [bootLockedAnalysis, pinUploadAnalysis, setAnalysis]);

  const checkDuplicateUpload = async (selectedFile) => {
    const fileHash = await computeFileHash(selectedFile);
    if (!fileHash) {
      return null;
    }
    try {
      const res = await api.post('/v1/coo/duplicate-check/', { file_hash: fileHash });
      const data = res.data || null;
      // Double check in UI: only trigger duplicate modal if the status was success/completed
      // and if there's an actual sheet_id we can point to.
      if (data && data.duplicate && (!['COMPLETED', 'SUCCESS'].includes(data.duplicate_status) || !data.duplicate_upload_id)) {
        return { duplicate: false };
      }
      return data;
    } catch (err) {
      return null;
    }
  };

  const finalizeFromAnalysis = (analysisData, completedRowsOverride = null) => {
    const safeAnalysis = analysisData && typeof analysisData === 'object' ? analysisData : {};
    const resolvedUploadId =
      safeAnalysis?.analysis_isolation?.sheet_id ||
      safeAnalysis?.metadata?.upload_id ||
      uploadId ||
      null;

    if (resolvedUploadId) {
      setUploadId(resolvedUploadId);
      // Ensure all pages read the same freshly analyzed sheet.
      pinUploadAnalysis(resolvedUploadId);
    }

    const baseRows = Array.isArray(completedRowsOverride) && completedRowsOverride.length
      ? completedRowsOverride
      : buildMockedRowsFromProducts(safeAnalysis);

    const normalizedRows = baseRows.map((row) => ({
      ...row,
      ai_status: row?.ai_status || 'COMPLETED',
      ai_result: row?.ai_result || row?.ai_reason || row?.why || row?.reason || '',
      cleaned_summary: row?.cleaned_summary || row?.ai_action || row?.what || '',
      prediction: row?.risk || row?.prediction || row?.ai_classification || row?.risk_level || 'HEALTHY',
      is_reinforced: row?.is_reinforced ?? true,
    }));

    const dynamicColumns = normalizedRows.length
      ? Object.keys(normalizedRows[0]).filter(
          (key) => !['ai_status', 'ai_result', 'cleaned_summary', 'prediction', 'is_reinforced', 'ai_status_label'].includes(key)
        )
      : ['product', 'current_stock', 'velocity'];

    const localAnalysis = buildLocalAnalysisFromRows(normalizedRows, safeAnalysis?.summary || {});
    const mergedAnalysis = {
      ...localAnalysis,
      ...safeAnalysis,
      products_analysis: normalizedRows,
      analysis_isolation: {
        ...(safeAnalysis?.analysis_isolation || {}),
        sheet_id: resolvedUploadId || safeAnalysis?.analysis_isolation?.sheet_id || null,
      },
    };

    const taggedAnalysis = tagAnalysisWithSession(mergedAnalysis, resolvedUploadId);

    backendRowsRef.current = normalizedRows;
    latestSummaryRef.current = safeAnalysis?.summary || {};
    totalRowsRef.current = normalizedRows.length;

    setData(normalizedRows);
    setColumns(dynamicColumns);
    setHybridResult(taggedAnalysis);
    setStats(deriveStatsFromAnalysis(taggedAnalysis, safeAnalysis?.summary || {}));
    setAnalysis(taggedAnalysis);
    setLogs([
      ...buildInitialLogsAfterAnalysis(taggedAnalysis),
      ...buildFinalizeLogs(taggedAnalysis, safeAnalysis?.summary || {}, normalizedRows),
    ]);
    setProcessingIdx(null);
    setStatus('UPLOADING');
    setPhaseLabel('Finalizing Results');
    setPhaseMessage('Preparing final output...');
    setProgressPct(100);
    setDisplayProgressPct(100);
    setProcessingSnapshot({ processed: normalizedRows.length, total: normalizedRows.length });
    setShowCompletionHold(true);
    setIsReanalysisMode(false);
    setError(null);
    try {
      if (hasMeaningfulAnalysisSnapshot(taggedAnalysis)) {
        localStorage.setItem(PROCESSOR_LOCKED_ANALYSIS_KEY, JSON.stringify(taggedAnalysis));
        setIsLockedSnapshotActive(true);
      } else {
        localStorage.removeItem(PROCESSOR_LOCKED_ANALYSIS_KEY);
        setIsLockedSnapshotActive(false);
      }
    } catch {
      // no-op
    }

    clearCompletionTransitionTimeout();
    completionTransitionTimeoutRef.current = setTimeout(() => {
      setStatus('READY');
      setPhaseLabel('Analysis Ready');
      setPhaseMessage('Upload complete. Review table or start real-time processing.');
      setShowCompletionHold(false);
      completionTransitionTimeoutRef.current = null;
    }, 900);
  };

  useEffect(() => {
    if (hybridResult || status !== 'IDLE') return;
    try {
      const raw = localStorage.getItem(PROCESSOR_LOCKED_ANALYSIS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      const resolvedUploadId = resolveAnalysisUploadId(parsed);
      setHybridResult(parsed);
      setStats(deriveStatsFromAnalysis(parsed));
      setStatus('READY');
      setIsLockedSnapshotActive(true);
      if (resolvedUploadId) {
        setUploadId(resolvedUploadId);
        pinUploadAnalysis(resolvedUploadId);
      }
    } catch {
      // no-op
    }
  }, [hybridResult, status, pinUploadAnalysis]);

  const finalizeSimulation = (update, summary = {}) => {
    const mergedAnalysis = {
      ...(update?.analysis || update?.result || hybridResult || {}),
      summary: {
        ...(update?.summary || {}),
        ...(summary || {}),
      },
    };

    const completedRows = Array.isArray(update?.rows) && update.rows.length
      ? update.rows
      : Array.isArray(update?.products_analysis) && update.products_analysis.length
        ? update.products_analysis
        : buildMockedRowsFromProducts(mergedAnalysis);

    finalizeFromAnalysis(mergedAnalysis, completedRows);
  };

  const runCooAnalysis = async (selectedFile, { confirmReplace = false } = {}) => {
    if (!selectedFile) return;

    setFile(selectedFile);
    setStatus('UPLOADING');
    setProgressPct(1);
    setDisplayProgressPct(1);
    lastProgressSignalRef.current = Date.now();
    setProcessingSnapshot({ processed: 0, total: 0 });
    setPhaseLabel('AI Schema Discovery');
    setIsReanalysisMode(false);
    setError(null);
    setAnalysis(null);
    try {
      localStorage.removeItem(PROCESSOR_LOCKED_ANALYSIS_KEY);
      setIsLockedSnapshotActive(false);
    } catch {
      // no-op
    }
    // Starting a brand-new analysis should not stay locked to an older pinned upload.
    clearPinnedUploadAnalysis();

    const formData = new FormData();
    formData.append('file', selectedFile);
    if (confirmReplace) {
      formData.append('confirm_replace', 'true');
    }

    try {
      // --- NEW MASTER PIPELINE (SINGLE POST) ---
      const res = await api.post('/v1/coo/analyze/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (progressEvent) => {
          const loaded = Number(progressEvent?.loaded || 0);
          const total = Number(progressEvent?.total || 0);
          if (!Number.isFinite(loaded) || !Number.isFinite(total) || total <= 0) return;
          const percentCompleted = Math.round((loaded * 100) / total);
          // Initial 0-20% for raw upload progress
          if (percentCompleted < 100) {
            const mapped = Math.floor(percentCompleted * 0.2);
            setProgressPct((prev) => Math.max(prev, mapped));
            setDisplayProgressPct((prev) => Math.max(prev, mapped));
            lastProgressSignalRef.current = Date.now();
          }
        }
      });

      const analysisData = res.data;
      const sheetId = analysisData?.analysis_isolation?.sheet_id;

      if (!sheetId) {
        finalizeFromAnalysis(analysisData);
        return;
      }

      // Analysis successful: Finalize progress UI
      setProgressPct(100);
      setDisplayProgressPct(100);
      setPhaseLabel('Analysis Complete');

      if (skipProcessingAnimation) {
        finalizeFromAnalysis(analysisData);
        return;
      }

      // Automatically trigger professional playback to show AI cleaning results
      runProfessionalPlayback(analysisData, analysisData?.products || []);
      return;

      // 2. Real-time Smooth Increment (20% to 100%)
      const token = localStorage.getItem('access_token');
      const baseUrl = getApiBaseUrl();
      const sseUrl = `${baseUrl}/ingestion/stream/${sheetId}/?token=${token}`;
      
      const es = new EventSource(sseUrl);
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          
          if (parsed.status === 'PROCESSING') {
            const serverProgressStr = String(parsed.progress || '0').replace('%', '');
            const serverProgress = parseInt(serverProgressStr) || 0;
            
            // Professional mapping: 
            // 0-30%: Uploading (Done before SSE)
            // 31-99%: Real-time Analysis (Mapped from Server 0-100)
            const uiProgress = Math.min(31 + Math.floor(serverProgress * 0.68), 99);
            
            setProgressPct((prev) => Math.max(prev, uiProgress));
            setDisplayProgressPct((prev) => Math.max(prev, uiProgress));
            lastProgressSignalRef.current = Date.now();
            setPhaseLabel(parsed.step || 'Neural Processing');
            setPhaseMessage(parsed.message || 'Crunching data vectors...');
            
            if (parsed.summary) {
              setStats({
                anomalies: parsed.summary.anomalies || 0,
                cleaned: parsed.summary.processed || 0,
                predictions: parsed.summary.total_records || 0,
                verified: parsed.summary.healthy || 0
              });
            }
          }

          if (parsed.status === 'COMPLETED') {
            es.close();
            setProgressPct(100);
            setDisplayProgressPct(100);

            finalizeFromAnalysis(analysisData);
          }
        } catch (e) {
          console.error("SSE Data Error:", e);
        }
      };

      es.onerror = (err) => {
        console.error("SSE Stream Error:", err);
        es.close();
        finalizeFromAnalysis(analysisData);
      };

    } catch (err) {
      if (err.response?.status === 409 && err.response?.data?.error === 'duplicate_upload') {
        setPendingUploadFile(selectedFile);
        setDuplicateInfo(err.response.data);
        setShowDuplicateConfirm(true);
        setStatus('IDLE');
        setProgressPct(0);
        setDisplayProgressPct(0);
        return;
      }
      setError(err.response?.data?.error || 'Upload failed');
      setStatus('IDLE');
    }
  };

  const handleUpload = async (e) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    // Reset UI state before checking
    setError(null);

    const duplicatePayload = await checkDuplicateUpload(selectedFile);
    if (duplicatePayload?.duplicate) {
      setPendingUploadFile(selectedFile);
      setDuplicateInfo(duplicatePayload);
      setShowDuplicateConfirm(true);
      setStatus('IDLE');
      setProgressPct(0);
      setDisplayProgressPct(0);
      e.target.value = '';
      return;
    }
    await runCooAnalysis(selectedFile);
    e.target.value = '';
  };

  const loadExistingAnalysis = async (uploadId) => {
    if (!uploadId) return;
    try {
      const res = await api.get(`/ingestion/upload-analysis/${uploadId}/`);
      const analysisData = res.data?.analysis;
      if (analysisData) {
        finalizeFromAnalysis(analysisData);
        return;
      }
      setError('Previous analysis is not available.');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load previous analysis.');
    }
  };

  const handleDuplicateKeepExisting = async () => {
    const existingId = duplicateInfo?.duplicate_upload_id;
    setShowDuplicateConfirm(false);
    setDuplicateInfo(null);
    setPendingUploadFile(null);
    await loadExistingAnalysis(existingId);
  };

  const handleDuplicateReplace = async () => {
    const fileToRetry = pendingUploadFile;
    setShowDuplicateConfirm(false);
    setDuplicateInfo(null);
    setPendingUploadFile(null);
    if (fileToRetry) {
      await runCooAnalysis(fileToRetry, { confirmReplace: true });
    }
  };
  const handleCommit = async () => {
    if (!hybridResult || !hybridResult.products_analysis) return;
    
    setLogs(prev => [
      ...prev,
      { message: 'Committing simulation results to production...', status: 'processing', type: 'info', category: 'Finalizing' }
    ]);

    try {
      await api.post('/v1/coo/commit/', {
        products: hybridResult.products_analysis
      });
      
      setLogs(prev => [
        ...prev,
        { message: 'DATABASE SYNC SUCCESS: Records are now live.', status: 'done', type: 'success', category: 'Finalizing' }
      ]);
      
      alert("Successfully committed transactions to Database.");
    } catch (err) {
      console.error('Commit failed:', err);
      setLogs(prev => [
        ...prev,
        { message: 'SYNC FAILURE: Could not persist to database.', status: 'done', type: 'error', category: 'Finalizing' }
      ]);
    }
  };

  // Reset everything and go back to upload screen
  const resetToIdle = () => {
    if (eventSourceRef.current) eventSourceRef.current.close();
    clearPlaybackInterval();
    clearCompletionTransitionTimeout();
    if (resultSlideTimeoutRef.current) {
      clearTimeout(resultSlideTimeoutRef.current);
      resultSlideTimeoutRef.current = null;
    }
    setFile(null);
    setUploadId(null);
    setData([]);
    setColumns([]);
    setStatus('IDLE');
    setProcessingIdx(null);
    setProgressPct(0);
    setLogs([]);
    setStats({ anomalies: 0, cleaned: 0, predictions: 0, verified: 0 });
    setHybridResult(null);
    setShowResultSlide(false);
    setShowCompletionHold(false);
    setShowReanalysisConfirm(false);
    setShowDuplicateConfirm(false);
    setDuplicateInfo(null);
    setPendingUploadFile(null);
    setIsReanalysisMode(false);
    setPhaseLabel('Data Cleaning');
    setTelemetry({ etaSeconds: 0, recordsPerSecond: 0, anomaliesDetected: 0 });
    setDisplayProgressPct(0);
    setProcessingSnapshot({ processed: 0, total: 0 });
    setError(null);
    setAnalysis(null);
    clearPinnedUploadAnalysis();
    try {
      localStorage.removeItem(PROCESSOR_LOCKED_ANALYSIS_KEY);
      setIsLockedSnapshotActive(false);
    } catch {
      // no-op
    }
    backendRowsRef.current = [];
    latestSummaryRef.current = {};
    totalRowsRef.current = 0;
    setSheetViewKey('analysis');
    setSheetClassFilter('ALL');
    setTableSearchQuery('');
    // Trigger file picker for new sheet
    setTimeout(() => newSheetInputRef.current?.click(), 100);
  };

  // Re-analyze: keep data, clear AI results and rerun
  const reAnalyze = () => {
    if (eventSourceRef.current) eventSourceRef.current.close();
    clearPlaybackInterval();
    clearCompletionTransitionTimeout();
    if (resultSlideTimeoutRef.current) {
      clearTimeout(resultSlideTimeoutRef.current);
      resultSlideTimeoutRef.current = null;
    }
    setShowResultSlide(false);
    setShowCompletionHold(false);
    setIsReanalysisMode(true);
    setStats({ anomalies: 0, cleaned: 0, predictions: 0, verified: 0 });
    setLogs([{ message: `Re-analysis requested for ${reanalysisSheetLabel}`, status: 'processing', type: 'info', category: 'Reanalysis' }]);
    setProgressPct(0);
    setPhaseLabel(`Re-Analysis: ${reanalysisSheetLabel}`);
    setTelemetry({ etaSeconds: 0, recordsPerSecond: 0, anomaliesDetected: 0 });
    setDisplayProgressPct(0);
    setProcessingSnapshot({ processed: 0, total: 0 });
    setSheetViewKey('analysis');
    setTableSearchQuery('');

    const replayRows = Array.isArray(hybridResult?.products_analysis) && hybridResult.products_analysis.length
      ? hybridResult.products_analysis
      : buildMockedRowsFromProducts(hybridResult || {});

    if (replayRows.length > 0) {
      if (skipProcessingAnimation) {
        finalizeFromAnalysis(hybridResult || {}, replayRows);
      } else {
        runProfessionalPlayback(hybridResult || {}, replayRows);
      }
      return;
    }

    if (uploadId) {
      setStatus('READY');
      return;
    }

    setStatus('HALTED');
    setError('No sheet data available for re-analysis. Please upload or process a sheet first.');
    setIsReanalysisMode(false);

    latestSummaryRef.current = {};
    totalRowsRef.current = 0;
  };

  const requestReAnalyze = () => {
    setShowReanalysisConfirm(true);
  };

  const confirmReAnalyze = () => {
    setShowReanalysisConfirm(false);
    reAnalyze();
  };

  // 1. Initialize Table Columns
  const tableColumns = useMemo(() => {
    if (columns.length === 0) return [];

    const baseCols = columns.map(col => ({
      id: String(col),
      header: col,
      accessorFn: (row) => row?.[col],
      cell: (info) => (
        <span className="font-mono text-xs text-slate-400">
          {info.getValue() !== null ? String(info.getValue()) : '—'}
        </span>
      )
    }));

    return [
      {
        header: 'Status',
        accessorKey: 'ai_status',
        cell: (info) => {
          const s = info.getValue();
          if (s === 'COMPLETED') return <CheckCircle2 className="text-emerald-500" size={16} />;
          if (s === 'PROCESSING') return <Loader2 className="text-emerald-400 animate-spin" size={16} />;
          return <div className="w-4 h-4 rounded-full border border-slate-700" />;
        }
      },
      ...baseCols,
      {
        header: 'Audit Finding',
        accessorKey: 'ai_result',
        cell: (info) => (
          <span className={`text-[10px] font-bold uppercase tracking-tight ${['OUT OF STOCK', 'LOW STOCK', 'DEADSTOCK', 'OVERSTOCK'].some(s => info.getValue()?.toUpperCase().includes(s)) ? 'text-rose-500' :
            info.getValue()?.includes('SYNCED') ? 'text-blue-400' : 'text-emerald-400/80'
            }`}>
            {info.getValue() || 'Analyzing...'}
          </span>
        )
      },
      {
        header: 'System Action',
        accessorKey: 'cleaned_summary',
        cell: (info) => (
          <span className="text-[10px] text-slate-500 italic">
            {info.getValue() || 'Healthy'}
          </span>
        )
      },
      {
        header: 'Business Status',
        accessorKey: 'prediction',
        cell: (info) => {
          const val = info.getValue()?.toUpperCase() || '';
          const isRisk = ['OUT OF STOCK', 'LOW STOCK', 'DEADSTOCK', 'OVERSTOCK'].some(s => val.includes(s));
          return (
            <div className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase inline-block ${isRisk ? 'bg-rose-500/20 text-rose-500' :
              val.includes('HEALTHY') ? 'bg-emerald-500/20 text-emerald-500' : 'bg-blue-500/20 text-blue-400'
              }`}>
              {info.getValue() || 'Waiting'}
            </div>
          );
        }
      },
      {
        header: 'Audit Check',
        accessorKey: 'is_reinforced',
        cell: (info) => (
          info.getValue() ? (
            <div className="flex items-center gap-1.5 text-[9px] font-black text-blue-400 uppercase tracking-tighter bg-blue-500/10 px-2 py-0.5 rounded-md border border-blue-500/20">
               Audit Passed
            </div>
          ) : (
            <span className="text-[9px] text-slate-700 font-bold uppercase ml-2">Verified</span>
          )
        )
      },
    ];
  }, [columns]);

  const sheetPreviewOptions = useMemo(() => {
    const previews = hybridResult?.metadata?.sheet_previews;
    return Array.isArray(previews) ? previews : [];
  }, [hybridResult]);

  const sheetDiagnosticsByName = useMemo(() => {
    const diagnostics = Array.isArray(hybridResult?.metadata?.sheet_diagnostics)
      ? hybridResult.metadata.sheet_diagnostics
      : [];
    return diagnostics.reduce((acc, item) => {
      acc[item.sheet_name] = item;
      return acc;
    }, {});
  }, [hybridResult]);

  const sheetClassOptions = useMemo(() => {
    const classes = [...new Set(sheetPreviewOptions.map((item) => String(item.classification || 'UNKNOWN')))].sort();
    return ['ALL', ...classes];
  }, [sheetPreviewOptions]);

  const filteredSheetOptions = useMemo(() => {
    return sheetPreviewOptions.filter((sheet) => {
      if (sheetClassFilter !== 'ALL' && String(sheet.classification) !== sheetClassFilter) {
        return false;
      }
      return true;
    });
  }, [sheetPreviewOptions, sheetClassFilter]);

  const activeSheetPreview = useMemo(() => {
    if (!sheetViewKey || sheetViewKey === 'analysis') return null;
    return sheetPreviewOptions.find((item) => item.sheet_name === sheetViewKey) || null;
  }, [sheetPreviewOptions, sheetViewKey]);

  useEffect(() => {
    if (!activeSheetPreview?.sheet_name) {
      setSheetPreviewPage(1);
      setSheetPreviewRows([]);
      setSheetPreviewTotalRows(null);
      setSheetPreviewRowsLoading(false);
      return;
    }
    setSheetPreviewPage(1);
  }, [activeSheetPreview?.sheet_name]);

  useEffect(() => {
    if (!activeSheetPreview?.sheet_name) return;
    setSheetPreviewPage(1);
  }, [tableSearchQuery, activeSheetPreview?.sheet_name]);

  useEffect(() => {
    if (!activeSheetPreview?.sheet_name) return;

    const resolvedUploadId = uploadId || hybridResult?.analysis_isolation?.sheet_id || null;
    const PAGE_SIZE = 300;
    if (!resolvedUploadId) {
      const fallbackRows = Array.isArray(activeSheetPreview.rows) ? activeSheetPreview.rows : [];
      setSheetPreviewRows(fallbackRows);
      setSheetPreviewTotalRows(
        Number.isFinite(Number(activeSheetPreview.total_rows))
          ? Number(activeSheetPreview.total_rows)
          : fallbackRows.length
      );
      setSheetPreviewRowsLoading(false);
      return;
    }

    let cancelled = false;
    const fetchSheetPage = async () => {
      setSheetPreviewRowsLoading(true);
      try {
        const res = await api.get(`/ingestion/upload-sheet-preview/${resolvedUploadId}/`, {
          params: {
            sheet_name: activeSheetPreview.sheet_name,
            page: sheetPreviewPage,
            page_size: PAGE_SIZE,
            search: tableSearchQuery.trim() || undefined,
            locate_batch: tableSearchQuery.trim() ? 'true' : undefined,
          },
        });
        if (cancelled) return;
        const rows = Array.isArray(res?.data?.rows) ? res.data.rows : [];
        const totalRows = Number(res?.data?.total_rows);
        const serverPage = Number(res?.data?.page);
        if (Number.isFinite(serverPage) && serverPage > 0 && serverPage !== sheetPreviewPage) {
          setSheetPreviewPage(serverPage);
        }
        setSheetPreviewRows(rows);
        setSheetPreviewTotalRows(Number.isFinite(totalRows) ? totalRows : rows.length);
      } catch {
        if (!cancelled) {
          if (sheetPreviewPage === 1) {
            const fallbackRows = Array.isArray(activeSheetPreview.rows) ? activeSheetPreview.rows : [];
            setSheetPreviewRows(fallbackRows);
            setSheetPreviewTotalRows(
              Number.isFinite(Number(activeSheetPreview.total_rows))
                ? Number(activeSheetPreview.total_rows)
                : fallbackRows.length
            );
          } else {
            setSheetPreviewRows([]);
          }
        }
      } finally {
        if (!cancelled) setSheetPreviewRowsLoading(false);
      }
    };

    fetchSheetPage();
    return () => {
      cancelled = true;
    };
  }, [activeSheetPreview, sheetPreviewPage, tableSearchQuery, uploadId, hybridResult]);

  const reanalysisSheetLabel = useMemo(() => {
    if (activeSheetPreview?.sheet_name) return activeSheetPreview.sheet_name;

    const previews = Array.isArray(hybridResult?.metadata?.sheet_previews)
      ? hybridResult.metadata.sheet_previews
      : [];

    if (previews.length === 1) {
      return previews[0]?.sheet_name || file?.name || 'Uploaded Sheet';
    }
    if (previews.length > 1) {
      const names = previews
        .map((item) => item?.sheet_name)
        .filter(Boolean)
        .slice(0, 2)
        .join(', ');
      return names || `${previews.length} sheets`;
    }

    return file?.name || hybridResult?.analysis_isolation?.sheet_name || 'Uploaded Sheet';
  }, [activeSheetPreview, hybridResult, file]);

  const activeSheetDiagnostics = useMemo(() => {
    if (!activeSheetPreview) return null;
    return sheetDiagnosticsByName[activeSheetPreview.sheet_name] || null;
  }, [activeSheetPreview, sheetDiagnosticsByName]);

  const previewColumns = useMemo(() => {
    if (!activeSheetPreview?.columns?.length) return [];
    return activeSheetPreview.columns.map((col) => ({
      id: String(col),
      header: String(col),
      accessorFn: (row) => row?.[col],
      cell: (info) => {
        const value = info.getValue();
        return (
          <span className="font-mono text-xs text-slate-400">
            {value !== null && value !== undefined && value !== '' ? String(value) : '—'}
          </span>
        );
      },
    }));
  }, [activeSheetPreview]);

  const filterFieldOptions = useMemo(() => {
    const baseFields = activeSheetPreview?.columns?.length
      ? activeSheetPreview.columns.map((col) => String(col))
      : ['ai_status', ...columns, 'ai_result', 'cleaned_summary', 'prediction', 'is_reinforced'];

    return ['ALL', ...new Set(baseFields.filter(Boolean).map((field) => String(field)))];
  }, [activeSheetPreview, columns]);

  const businessFilterOptions = useMemo(() => {
    const sourceRows = activeSheetPreview
      ? (Array.isArray(sheetPreviewRows) ? sheetPreviewRows : (activeSheetPreview.rows || []))
      : data;
    const values = new Set();
    sourceRows.forEach((row) => {
      const rawValue = row?.prediction ?? row?.risk ?? row?.ai_classification ?? row?.inventory_status;
      const normalizedValue = String(rawValue ?? '').trim();
      if (normalizedValue) values.add(normalizedValue.toUpperCase());
    });
    return ['ALL', ...Array.from(values).sort()];
  }, [activeSheetPreview, sheetPreviewRows, data]);

  const hasAdvancedFilters = useMemo(() => {
    return Boolean(
      tableSearchQuery.trim() ||
      tableSearchField !== 'ALL' ||
      tableSearchMode !== 'contains' ||
      tableStatusFilter !== 'ALL' ||
      tableBusinessFilter !== 'ALL'
    );
  }, [tableBusinessFilter, tableSearchField, tableSearchMode, tableSearchQuery, tableStatusFilter]);

  const resetAdvancedFilters = () => {
    setTableSearchQuery('');
    setTableSearchField('ALL');
    setTableSearchMode('contains');
    setTableStatusFilter('ALL');
    setTableBusinessFilter('ALL');
  };

  const displayData = activeSheetPreview
    ? (Array.isArray(sheetPreviewRows) ? sheetPreviewRows : (activeSheetPreview.rows || []))
    : data;
  const filteredDisplayData = useMemo(() => {
    const query = tableSearchQuery.trim().toLowerCase();
    return displayData.filter((row) => {
      const normalizedStatus = String(row?.ai_status ?? '').toUpperCase();
      const normalizedBusiness = String(
        row?.prediction ?? row?.risk ?? row?.ai_classification ?? row?.inventory_status ?? ''
      ).toUpperCase();

      if (tableStatusFilter !== 'ALL' && normalizedStatus !== tableStatusFilter) {
        return false;
      }

      if (tableBusinessFilter !== 'ALL' && normalizedBusiness !== tableBusinessFilter) {
        return false;
      }

      if (!query && !['empty', 'not_empty'].includes(tableSearchMode)) {
        return true;
      }

      const fieldValues = tableSearchField === 'ALL'
        ? Object.values(row || {})
        : [row?.[tableSearchField]];

      return fieldValues.some((value) => {
        const normalizedValue = String(value ?? '').trim().toLowerCase();

        if (tableSearchMode === 'empty') {
          return normalizedValue.length === 0;
        }
        if (tableSearchMode === 'not_empty') {
          return normalizedValue.length > 0;
        }
        if (!query) {
          return true;
        }
        if (tableSearchMode === 'equals') {
          return normalizedValue === query;
        }
        if (tableSearchMode === 'starts_with') {
          return normalizedValue.startsWith(query);
        }
        return normalizedValue.includes(query);
      });
    });
  }, [displayData, tableBusinessFilter, tableSearchField, tableSearchMode, tableSearchQuery, tableStatusFilter]);
  const displayTableColumns = activeSheetPreview ? previewColumns : tableColumns;
  const displayColumnsCount = activeSheetPreview?.columns?.length || columns.length;
  const effectiveProcessingIndex = activeSheetPreview || hasAdvancedFilters ? null : processingIdx;

  const analysisCards = useMemo(() => {
    const analysis = hybridResult || {};
    const stock = analysis.stock_analysis || {};
    const products = Array.isArray(analysis.products) ? analysis.products : [];
    const productsAnalysis = Array.isArray(analysis.products_analysis) ? analysis.products_analysis : [];
    // Merge both sources so cached/reference payloads can still recover sales from products.
    const sourceRows = productsAnalysis.length ? [...productsAnalysis, ...products] : products;
    const forecast = Array.isArray(analysis.demand_forecast) ? analysis.demand_forecast : [];
    const schemaStatus = String(analysis.schema_status || '').toUpperCase();

    const salesTotal = deriveSalesTotalFromAnalysis(analysis, sourceRows);

    const salesTrend = analysis.sales_summary?.trend && analysis.sales_summary?.trend !== 'Data not available'
      ? analysis.sales_summary.trend
      : 'Derived from current uploaded sheet';

    const numericForecastTotal = Number(analysis.forecast_summary?.total_predicted_demand);
    const forecastTotal = Number.isFinite(numericForecastTotal)
      ? numericForecastTotal
      : forecast.reduce((sum, item) => sum + Number(item?.predicted_demand || 0), 0);

    let forecastPattern = analysis.forecast_summary?.daily_pattern;
    if (!forecastPattern || forecastPattern === 'Data not available') {
      if (forecast.length >= 2) {
        const first = Number(forecast[0]?.predicted_demand || 0);
        const last = Number(forecast[forecast.length - 1]?.predicted_demand || 0);
        if (last > first) {
          forecastPattern = 'Increasing';
        } else if (last < first) {
          forecastPattern = 'Decreasing';
        } else {
          forecastPattern = 'Stable';
        }
      } else {
        forecastPattern = 'No dated sales data';
      }
    }

    const analysisCounts = deriveUnifiedRiskCounts(analysis, 10);

    const totalProducts = Number(
      analysis?.inventory_summary?.total_products
      || analysis?.summary?.processed
      || sourceRows.length
      || data.length
      || 0
    );

    const resolvedCounts = analysisCounts;

    return {
      salesTotal,
      salesTrend,
      forecastTotal,
      forecastPattern,
      lowStock: resolvedCounts.lowStock,
      outOfStock: resolvedCounts.outOfStock,
      overStock: resolvedCounts.overStock,
      healthy: resolvedCounts.healthy,
      deadstockCount: resolvedCounts.deadstockCount,
      needsReview: resolvedCounts.needsReview || 0,
      schemaStatus
    };
  }, [hybridResult, data, status]);

  const rankedAlerts = useMemo(() => {
    const alerts = Array.isArray(hybridResult?.alerts) ? hybridResult.alerts : [];

    const getAlertPriority = (alert) => {
      const raw = `${alert?.severity || ''} ${alert?.type || ''} ${alert?.message || ''}`.toUpperCase();
      if (raw.includes('CRITICAL') || raw.includes('OUT OF STOCK')) return 4;
      if (raw.includes('HIGH') || raw.includes('LOW STOCK') || raw.includes('DEADSTOCK')) return 3;
      if (raw.includes('MEDIUM') || raw.includes('OVERSTOCK') || raw.includes('WARNING')) return 2;
      return 1;
    };

    return alerts
      .map((alert, index) => ({
        index,
        type: String(alert?.type || 'Alert'),
        product: String(alert?.product || alert?.message || 'Inventory requires review'),
        priority: getAlertPriority(alert),
      }))
      .sort((a, b) => b.priority - a.priority || a.index - b.index);
  }, [hybridResult]);

  const runProfessionalPlayback = (analysisData, completedRows) => {
    clearPlaybackInterval();

    if (skipProcessingAnimation) {
      finalizeFromAnalysis(analysisData, completedRows);
      return;
    }

    if (analysisData && typeof analysisData === 'object') {
      setHybridResult(analysisData);
      setStats(buildStatsFromAnalysisSummary(analysisData));
      setAnalysis(analysisData);
    }

    const total = completedRows.length;
    if (total === 0) {
      setData([]);
      setColumns(['product', 'current_stock', 'velocity']);
      setStatus('COMPLETED');
      setProcessingIdx(null);
      setProgressPct(100);
      setDisplayProgressPct(100);
      setProcessingSnapshot({ processed: 0, total: 0 });
      setShowResultSlide(true);
      setIsReanalysisMode(false);
      return;
    }

    const pendingRows = buildPendingRows(completedRows);

    backendRowsRef.current = pendingRows;
    setData(pendingRows);
    setColumns(['product', 'current_stock', 'velocity']);
    setStatus('PROCESSING');
    setShowResultSlide(false);
    setShowCompletionHold(false);
    setProcessingIdx(0);
    setPhaseLabel('AI Analysis');
    setProgressPct(0);
    setDisplayProgressPct(0);
    setProcessingSnapshot({ processed: 0, total });
    lastProgressSignalRef.current = Date.now();

    const chunkSize = total > 3000 ? 50 : total > 1000 ? 25 : total > 400 ? 12 : 1;
    const tickMs = 80; // Slower tick for more visible progress
    const startedAt = Date.now();
    let cursor = 0;

    playbackIntervalRef.current = setInterval(() => {
      const next = [...backendRowsRef.current];
      // Process one by one or small chunk to show incremental progress
      const currentChunkSize = Math.max(1, Math.floor(chunkSize * (0.8 + Math.random() * 0.4))); 
      const start = cursor;
      const end = Math.min(total, start + currentChunkSize);

      for (let i = start; i < end; i += 1) {
        next[i] = {
          ...completedRows[i],
          ai_status: 'COMPLETED',
          is_reinforced: true,
        };
      }

      cursor = end;
      backendRowsRef.current = next;
      setData(next);

      const processed = cursor;
      const progress = Math.min(100, (processed / total) * 100);
      const elapsedSec = Math.max(0.1, (Date.now() - startedAt) / 1000);
      const rps = processed / elapsedSec;
      const eta = rps > 0 ? (total - processed) / rps : 0;

      setProcessingIdx(Math.max(0, processed - 1));
      setProgressPct(progress);
      setDisplayProgressPct(progress);
      setProcessingSnapshot({ processed, total });
      lastProgressSignalRef.current = Date.now();
      setTelemetry({
        etaSeconds: eta,
        recordsPerSecond: rps,
        anomaliesDetected: Number((analysisData.alerts || []).length),
      });
      setLogs((prev) => {
        const msg = `Live analysis processing ${processed}/${total} rows`;
        if (prev.length > 0 && prev[prev.length - 1]?.message === msg) return prev;
        const trimmed = prev.length > 6 ? prev.slice(prev.length - 6) : prev;
        return [...trimmed, { message: msg, status: 'processing', type: 'info', category: 'AI Analysis' }];
      });

      if (cursor >= total) {
        clearPlaybackInterval();
        setTimeout(() => {
          setProcessingIdx(null);
          setStatus('COMPLETED');
          setProgressPct(100);
          setDisplayProgressPct(100);
          setPhaseLabel('Finalizing');
          setShowResultSlide(true);
          setIsReanalysisMode(false);
        }, 800);
      }
    }, tickMs);
  };

  // 3. Start AI Stream
  const startProcessing = () => {
    if (!uploadId) return;
    if (resultSlideTimeoutRef.current) {
      clearTimeout(resultSlideTimeoutRef.current);
      resultSlideTimeoutRef.current = null;
    }
    setShowResultSlide(false);
    setShowCompletionHold(false);
    setStatus('PROCESSING');
    setProgressPct(0);
    setPhaseLabel('Data Cleaning');
    setDisplayProgressPct(0);
    setAnalysis(null);
    setProcessingIdx(null);
    latestSummaryRef.current = {};
    totalRowsRef.current = totalRowsRef.current || data.length;
    setProcessingSnapshot({ processed: 0, total: totalRowsRef.current || data.length || 0 });
    setLogs(buildStartProcessingLogs());

    // SSE requires Authorization headers which EventSource doesn't support natively
    // We use a token-in-URL approach or a specific library, but for simplicity here 
    // we'll use a standard EventSource if the backend allows it via session/cookie 
    // or just pass the token as a query param.
    const token = localStorage.getItem('access_token');
    const baseUrl = getApiBaseUrl();
    const reanalysisParam = isReanalysisMode ? '&confirm_reanalysis=true' : '';
    const sseUrl = `${baseUrl}/ingestion/stream/${uploadId}/?token=${token}${reanalysisParam}`;

    const es = new EventSource(sseUrl);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      const update = JSON.parse(event.data);
      const { status, progress, summary, current_batch, stage, rps, eta, batch_rows } = update;

      const processed = Number(summary?.processed || 0);
      const total = Number(summary?.total_records || totalRowsRef.current || data.length || 0);
      latestSummaryRef.current = summary || {};
      totalRowsRef.current = total || totalRowsRef.current;

      if (status === 'ROW') {
        const rowIndex = Number(update.row_index || 0);
        const row = update.row || {};
        const existing = backendRowsRef.current[rowIndex] || {};
        backendRowsRef.current[rowIndex] = {
          ...existing,
          ...row,
          ai_status: 'COMPLETED',
          ai_result: row.ai_reason || row.ai_message || row.ai_classification,
          cleaned_summary: row.ai_action || row.ai_message || existing.cleaned_summary,
          prediction: row.ai_classification,
          ai_status_label: row.ai_status_label
        };
        setData(prev => {
          if (!prev.length) return prev;
          const next = [...prev];
          next[rowIndex] = { ...next[rowIndex], ...backendRowsRef.current[rowIndex] };
          return next;
        });

        if (total > 0) {
          const backendProgress = Math.min(100, Math.max(0, (processed / total) * 100));
          setPhaseLabel(getPhaseFromProgress(backendProgress));
          setProgressPct((prev) => Math.max(prev, backendProgress));
          setDisplayProgressPct((prev) => Math.max(prev, backendProgress));
          lastProgressSignalRef.current = Date.now();
        }

        const liveAnalysis = tagAnalysisWithSession(
          buildAnalysisFromSummary(summary || {}, backendRowsRef.current),
          uploadId
        );
        setHybridResult(liveAnalysis);
        setStats(deriveStatsFromAnalysis(liveAnalysis, summary));
        setAnalysis(liveAnalysis);
        setProcessingSnapshot({ processed, total: total || 0 });
        return;
      }

      // 1. Handle Completion
      if (status === 'COMPLETED') {
        finalizeSimulation(update, summary || {});
        es.close();
        return;
      }

      // 2. Handle Mapping Required (Low Confidence)
      if (status === 'MAPPING_REQUIRED') {
        setStatus('HALTED');
        setError(update.message || 'Low analysis confidence. Please verify mappings.');
        setLogs(prev => [...prev, { message: 'Neural Guard: Mapping required due to low confidence.', status: 'warning', type: 'warning', category: 'Validation' }]);
        es.close();
        return;
      }

      // 3. Handle Errors
      if (status === 'error') {
        setStatus('READY');
        setError(update.message || 'Analysis failed. Please check your dataset format.');
        setLogs(prev => [...prev, { message: `Engine Error: ${update.message}`, status: 'error', type: 'error', category: 'Finalizing' }]);
        es.close();
        return;
      }

      // 4. Handle Real-Time Progress Batches
      if (status === 'PROCESSING') {
        const lastIndex = Number(summary?.last_row_index ?? -1);
        if (lastIndex >= 0) {
          setProcessingIdx(lastIndex);
        }

        if (Array.isArray(batch_rows) && batch_rows.length > 0) {
          setData(prev => {
            const next = [...prev];
            batch_rows.forEach((item) => {
              const idx = Number(item?.row_index);
              if (!Number.isFinite(idx) || idx < 0 || idx >= next.length) return;
              const row = item?.row || {};
              next[idx] = {
                ...next[idx],
                ...row,
                ai_status: 'COMPLETED',
                ai_result: row.ai_reason || row.ai_message || row.ai_classification,
                cleaned_summary: row.ai_action || row.ai_message || next[idx]?.cleaned_summary,
                prediction: row.ai_classification,
                ai_status_label: row.ai_status_label,
              };
              backendRowsRef.current[idx] = next[idx];
            });
            return next;
          });
        }

        const liveAnalysis = tagAnalysisWithSession(
          buildAnalysisFromSummary(summary || {}, backendRowsRef.current),
          uploadId
        );
        setHybridResult(liveAnalysis);
        setStats(deriveStatsFromAnalysis(liveAnalysis, summary));
        setAnalysis(liveAnalysis);
        setProcessingSnapshot({ processed, total: total || 0 });
        const backendProgress = Number(progress ?? (processed / Math.max(total, 1)) * 100);
        setProgressPct((prev) => Math.max(prev, backendProgress));
        setDisplayProgressPct((prev) => Math.max(prev, backendProgress));
        lastProgressSignalRef.current = Date.now();
        if (stage) {
          setPhaseLabel(String(stage));
        } else if (total > 0) {
          setPhaseLabel(getPhaseFromProgress(backendProgress));
        }

        const computedStock = liveAnalysis?.stock_analysis || {};
        const backendAnomalyCount = Number(computedStock?.out_of_stock_items || 0)
          + Number(computedStock?.low_stock_items || 0)
          + Number(computedStock?.deadstock_items || 0)
          + Number(computedStock?.overstock_items || 0);
        setTelemetry({
          etaSeconds: Number(eta || 0),
          recordsPerSecond: Number(rps || 0),
          anomaliesDetected: backendAnomalyCount,
        });

        if (update.message || current_batch) {
           setLogs(prev => {
              const newLogs = [...prev];
              const message = update.message || `Processing Sector ${current_batch?.start}-${current_batch?.end} [${progress}]`;
              if (newLogs.length && newLogs[newLogs.length - 1]?.message === message) return newLogs;
              if (newLogs.length > 5) newLogs.shift();
              return [...newLogs, { message, status: 'processing', type: 'info', category: getPhaseFromProgress((processed / Math.max(total, 1)) * 100) }];
           });
        }
      }
    };

    es.onerror = (err) => {
      console.error('SSE Error:', err);
      if (status === 'PROCESSING') {
        setError('Stream connection interrupted.');
        setStatus('HALTED');
      }
      es.close();
    };

  };

  useEffect(() => {
    setDisplayProgressPct(progressPct);
  }, [progressPct]);

  useEffect(() => {
    if (status !== 'UPLOADING' && status !== 'PROCESSING') return;

    // Keep UI visibly moving when backend emits sparse updates.
    const intervalId = setInterval(() => {
      const idleForMs = Date.now() - lastProgressSignalRef.current;
      if (idleForMs < 900) return;

      // Allow progress to crawl very slowly beyond 96% to show activity for large files
      const cap = status === 'UPLOADING' ? 98.8 : 99.6;
      
      const nextProgress = (prev) => {
        if (prev >= cap) return prev;
        
        let bump = 0.22;
        if (prev < 20) bump = 0.9;
        else if (prev < 55) bump = 0.65;
        else if (prev < 80) bump = 0.4;
        else if (prev < 96) bump = 0.22;
        else if (prev < 97.5) bump = 0.04; // Crawl
        else bump = 0.01; // Snail crawl for very long analyses

        const next = Math.min(cap, Number((prev + bump).toFixed(2)));
        
        // Dynamic message updates for long-running analyses
        if (next > 96.5 && phaseMessage === 'Crunching data vectors...') {
          setPhaseMessage('Performing deep analysis on large dataset...');
        }
        if (next > 98.2 && phaseMessage === 'Performing deep analysis on large dataset...') {
          setPhaseMessage('Finalizing complex business insights...');
        }

        return next;
      };

      setProgressPct(nextProgress);
      setDisplayProgressPct(nextProgress);
    }, 450);

    return () => clearInterval(intervalId);
  }, [status, phaseMessage]);

  const dynamicStatusText = useMemo(
    () => getDynamicStatusText(displayProgressPct, phaseLabel),
    [displayProgressPct, phaseLabel]
  );

  const formattedProgress = `${displayProgressPct.toFixed(1)}%`;

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
      clearPlaybackInterval();
      clearCompletionTransitionTimeout();
      if (resultSlideTimeoutRef.current) {
        clearTimeout(resultSlideTimeoutRef.current);
        resultSlideTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!hybridResult) return;
    setStats(deriveStatsFromAnalysis(hybridResult));
  }, [hybridResult]);

  useEffect(() => {
    if (!sharedAnalysis || typeof sharedAnalysis !== 'object') return;
    if (!hasMeaningfulAnalysisSnapshot(sharedAnalysis)) {
      // Ignore weak/stale payloads that create fake cards on refresh/reference.
      return;
    }
    // Master stability rule:
    // Once processor has a finalized/local snapshot, do not let background context polling
    // rewrite cards on refresh/reference. This keeps values 100% stable for the locked upload.
    if (
      hybridResult
      && ['READY', 'COMPLETED', 'HALTED'].includes(String(status || '').toUpperCase())
    ) {
      return;
    }

    const sharedSession = getAnalysisSessionKey(sharedAnalysis);
    const localSession = getAnalysisSessionKey(hybridResult);
    const sharedUploadId = Number(
      sharedAnalysis?.analysis_isolation?.sheet_id
      || sharedAnalysis?.analysis_isolation?.upload_id
      || sharedAnalysis?.metadata?.upload_id
      || 0
    );
    const localUploadId = Number(
      uploadId
      || hybridResult?.analysis_isolation?.sheet_id
      || hybridResult?.analysis_isolation?.upload_id
      || hybridResult?.metadata?.upload_id
      || 0
    );

    // Hard lock: once this page is bound to an upload, ignore context updates from other uploads.
    if (
      Number.isFinite(localUploadId)
      && localUploadId > 0
      && Number.isFinite(sharedUploadId)
      && sharedUploadId > 0
      && sharedUploadId !== localUploadId
    ) {
      return;
    }

    if (!hybridResult || sharedSession !== localSession) {
      setHybridResult(sharedAnalysis);
      const resolvedUploadId = sharedUploadId;
      if (Number.isFinite(resolvedUploadId) && resolvedUploadId > 0) {
        setUploadId(resolvedUploadId);
        // Keep processor state stable across refresh/reference by pinning the same upload.
        pinUploadAnalysis(resolvedUploadId);
      }
    }
  }, [sharedAnalysis, hybridResult, uploadId, pinUploadAnalysis, status]);

  const exportCSV = () => {
    console.log("Initializing Export...", { dataLength: data?.length, columns });
    if (!data || data.length === 0) {
      console.warn("Export failed: No data available.");
      return;
    }
    const csvString = buildCsvString(data, columns);
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.body.appendChild(document.createElement('a'));
    link.href = url;
    link.setAttribute('download', `ai_orchestrator_export_${new Date().getTime()}.csv`);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    console.log("Export Successful.");
  };

  const handleEmergencyHalt = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setStatus('HALTED');
  };

  return (
    <div className="overflow-x-hidden pb-20 pt-8 space-y-10">
      <ProcessorHeader
        isNeuralCooldown={isNeuralCooldown}
        stats={stats}
        status={status}
        isLight={isLight}
        onStartProcessing={reAnalyze}
        onRequestReAnalyze={requestReAnalyze}
        onResetToIdle={resetToIdle}
        isReanalysisMode={isReanalysisMode}
        reanalysisSheetLabel={reanalysisSheetLabel}
      />

      <AnalysisSummaryPanel
        hybridResult={hybridResult}
        analysisCards={analysisCards}
        rankedAlerts={rankedAlerts}
        isLockedSnapshotActive={isLockedSnapshotActive}
        onCommit={handleCommit}
        onResetToIdle={resetToIdle}
      />

      <ProcessorMainSection
        status={status}
        isLight={isLight}
        uploadProgressPct={displayProgressPct}
        uploadFormattedProgress={formattedProgress}
        uploadPhaseLabel={phaseLabel}
        uploadPhaseMessage={phaseMessage}
        uploadStatusText={dynamicStatusText}
        fileInputRef={fileInputRef}
        newSheetInputRef={newSheetInputRef}
        onUpload={handleUpload}
        sheetPreviewOptions={sheetPreviewOptions}
        sheetClassFilter={sheetClassFilter}
        setSheetClassFilter={setSheetClassFilter}
        sheetViewKey={sheetViewKey}
        setSheetViewKey={setSheetViewKey}
        sheetClassOptions={sheetClassOptions}
        filteredSheetOptions={filteredSheetOptions}
        activeSheetPreview={activeSheetPreview}
        sheetPreviewPage={sheetPreviewPage}
        setSheetPreviewPage={setSheetPreviewPage}
        sheetPreviewTotalRows={sheetPreviewTotalRows}
        sheetPreviewRowsLoading={sheetPreviewRowsLoading}
        tableSearchQuery={tableSearchQuery}
        setTableSearchQuery={setTableSearchQuery}
        tableSearchField={tableSearchField}
        setTableSearchField={setTableSearchField}
        tableSearchMode={tableSearchMode}
        setTableSearchMode={setTableSearchMode}
        tableStatusFilter={tableStatusFilter}
        setTableStatusFilter={setTableStatusFilter}
        tableBusinessFilter={tableBusinessFilter}
        setTableBusinessFilter={setTableBusinessFilter}
        filterFieldOptions={filterFieldOptions}
        businessFilterOptions={businessFilterOptions}
        hasAdvancedFilters={hasAdvancedFilters}
        onResetAdvancedFilters={resetAdvancedFilters}
        onToggleFullscreen={toggleFullscreen}
        isFullscreen={isLayoutFullscreen}
        activeSheetDiagnostics={activeSheetDiagnostics}
        filteredDisplayData={filteredDisplayData}
        displayColumnsCount={displayColumnsCount}
        displayTableColumns={displayTableColumns}
        effectiveProcessingIndex={effectiveProcessingIndex}
      />

      <AnimatePresence>
        {showReanalysisConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-transparent flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              className="w-full max-w-xl rounded-[2rem] border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-6 shadow-[0_22px_60px_rgba(234,88,12,0.18)]"
            >
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-600 mb-2">Please Confirm</div>
              <h3 className="text-3xl font-black text-slate-900 tracking-tight">Run analysis again?</h3>
              <p className="text-base text-slate-600 mt-3 leading-relaxed">
                You are going to run this sheet again: <span className="font-black text-emerald-600">{reanalysisSheetLabel}</span>.
                The old result will be replaced.
              </p>

              <div className="mt-6 flex items-center justify-end gap-3">
                <button
                  onClick={() => setShowReanalysisConfirm(false)}
                  className="px-5 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 text-xs font-black uppercase tracking-widest hover:border-slate-300"
                >
                  No, Keep Old
                </button>
                <button
                  onClick={confirmReAnalyze}
                  className="px-5 py-2.5 rounded-xl bg-amber-500 text-slate-950 text-xs font-black uppercase tracking-widest shadow-[0_10px_24px_rgba(245,158,11,0.35)] hover:bg-amber-400"
                >
                  Yes, Run Again
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDuplicateConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-transparent flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              className="w-full max-w-xl rounded-[2rem] border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-cyan-50 p-6 shadow-[0_22px_60px_rgba(16,185,129,0.18)]"
            >
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600 mb-2">Duplicate File Found</div>
              <h3 className="text-3xl font-black text-slate-900 tracking-tight">This file is already analyzed</h3>
              <p className="text-base text-slate-600 mt-3 leading-relaxed">
                We already have results for <span className="font-black text-emerald-600">{duplicateInfo?.duplicate_sheet_name || 'this file'}</span>.
                You can use the old result or create a new one.
              </p>

              {duplicateInfo?.duplicate_completed_at && (
                <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Last Completed</p>
                  <p className="text-sm text-slate-700 mt-1 font-semibold">
                    {new Date(duplicateInfo.duplicate_completed_at).toLocaleString()}
                  </p>
                </div>
              )}

              <div className="mt-6 flex items-center justify-end gap-3">
                <button
                  onClick={handleDuplicateKeepExisting}
                  className="px-5 py-2.5 rounded-xl border border-emerald-100 bg-emerald-50 text-slate-600 text-xs font-black uppercase tracking-widest hover:border-emerald-200"
                >
                  No, Use Existing
                </button>
                <button
                  onClick={handleDuplicateReplace}
                  className="px-5 py-2.5 rounded-xl bg-emerald-500 text-slate-950 text-xs font-black uppercase tracking-widest shadow-[0_10px_24px_rgba(16,185,129,0.35)] hover:bg-emerald-400"
                >
                  Yes, Replace Result
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Professional Neural Result Slide (Slide Top to Bottom) */}
      <AnimatePresence>
        {showResultSlide && (
           <EnterpriseNeuralResult 
             result={hybridResult} 
             onClose={() => setShowResultSlide(false)} 
             onExport={exportCSV} 
           />
        )}
      </AnimatePresence>
    </div>
  );
};

export default AIRealTimeProcessor;

