import re
import logging
from difflib import SequenceMatcher
from typing import Dict, List, Tuple, Any

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


class ExcelProcessor:
    """
    Production-grade multi-sheet ingestion engine.

    Phases covered:
    - Phase 1: load all sheets
    - Phase 2: classify sheet role by column pattern
    - Phase 3: fuzzy map columns with threshold >= 70
    - Phase 4: clean and validate records
    """

    FUZZY_THRESHOLD = 70

    SHEET_TARGETS: Dict[str, Dict[str, List[str]]] = {
        "TRANSACTION": {
            "date": ["date", "bill_date", "txn_date", "transaction_date", "invoice_date"],
            "product": ["product", "item", "sku", "material", "item_name", "description"],
            "quantity": ["qty", "quantity", "units", "unit", "pcs", "pieces"],
            "type": ["type", "in/out", "txn_type", "transaction_type", "movement", "dr_cr"],
            "price": ["price", "rate", "amount", "value", "unit_price", "line_total"],
            "customer": ["customer", "party", "client", "buyer", "account_name"],
            "location": ["location", "warehouse", "branch", "plant", "unit", "site", "godown"],
        },
        "PRODUCT_MASTER": {
            "product": ["product", "item", "sku", "item_code", "product_code"],
            "price": ["price", "mrp", "rate", "selling_price", "unit_price"],
            "cost": ["cost", "purchase_price", "buy_rate", "cost_price"],
            "category": ["category", "group", "class", "segment", "family"],
            "description": ["description", "details", "product_name", "item_name"],
            "location": ["location", "warehouse", "branch", "plant", "site", "godown"],
        },
        "CUSTOMER_DATA": {
            "customer": ["customer", "party", "client", "buyer", "account", "customer_name"],
            "phone": ["phone", "mobile", "contact", "telephone", "cell"],
            "address": ["address", "city", "region", "location"],
            "email": ["email", "mail", "contact_email", "email_id"],
        },
        "INVENTORY_REFERENCE": {
            "product": ["product", "item", "sku", "item_name"],
            "stock": ["stock", "opening_stock", "current_stock", "balance", "on_hand", "qty"],
            "location": ["location", "warehouse", "branch", "plant", "site", "godown"],
            "price": ["price", "rate", "unit_price", "mrp"],
        },
        "FIX_DATA": {
            "source_party": ["source_party", "party", "raw_party", "alias", "old_party", "from_name", "from"],
            "target_party": ["target_party", "normalized_party", "standard_party", "canonical_party", "to_name", "to"],
            "source_product": ["source_product", "raw_product", "product_alias", "old_product"],
            "target_product": ["target_product", "normalized_product", "standard_product", "canonical_product", "product_name"],
        },
    }

    SHEET_NAME_HINTS: Dict[str, List[str]] = {
        "TRANSACTION": ["entry", "party_data", "partydata", "transaction", "sales", "ledger"],
        "INVENTORY_REFERENCE": ["ink_data", "inkdata", "inventory", "stock"],
        "FIX_DATA": ["fix-data", "fix_data", "fixdata", "mapping", "normalize"],
        "ANALYTICS_REFERENCE": ["back-end", "backend", "analytics", "summary"],
        "CUSTOMER_DATA": ["party_cus", "partycus", "customer", "client"],
    }

    def __init__(self, file_path_or_obj: Any):
        self.file_path_or_obj = file_path_or_obj
        self.sheets: Dict[str, pd.DataFrame] = {}
        self.classified_sheets: Dict[str, List[Dict[str, Any]]] = {
            "TRANSACTION": [],
            "PRODUCT_MASTER": [],
            "CUSTOMER_DATA": [],
            "INVENTORY_REFERENCE": [],
            "FIX_DATA": [],
            "ANALYTICS_REFERENCE": [],
            "IGNORE": [],
        }
        self.data_quality_report: List[str] = []
        self.warnings: List[str] = []
        self.confidence_score: float = 0.0
        self.sheet_diagnostics: List[Dict[str, Any]] = []

    def load_and_classify(self) -> Dict[str, List[Dict[str, Any]]]:
        self.sheets = self._load_all_sheets()
        if not self.sheets:
            raise ValueError("No readable sheets found in input file")

        sheet_confidences: List[float] = []

        for sheet_name, raw_df in self.sheets.items():
            clean_input_df = self._pre_clean_structure(raw_df)
            if clean_input_df.empty:
                self.sheet_diagnostics.append(
                    {
                        "sheet_name": sheet_name,
                        "raw_rows": int(len(raw_df)),
                        "rows_after_clean": 0,
                        "columns": [str(c) for c in raw_df.columns],
                        "classification": "IGNORE",
                        "mapping": {},
                        "confidence": 0,
                    }
                )
                self.classified_sheets["IGNORE"].append(
                    {
                        "name": sheet_name,
                        "df": clean_input_df,
                        "mapping": {},
                        "score": 0,
                        "warnings": ["Sheet is empty after structural cleanup"],
                    }
                )
                self.data_quality_report.append(f"Sheet '{sheet_name}' ignored: no usable rows")
                continue

            sheet_type, mapping, score = self._classify_sheet(clean_input_df, sheet_name)
            cleaned_df, clean_warnings = self._clean_sheet(clean_input_df, mapping, sheet_type)

            if sheet_type == "TRANSACTION" and not mapping.get("date"):
                clean_warnings.append("Date column not mapped; active-day and trend calculations may be conservative")

            payload = {
                "name": sheet_name,
                "df": cleaned_df,
                "mapping": mapping,
                "score": int(round(score)),
                "warnings": clean_warnings,
            }
            self.classified_sheets[sheet_type].append(payload)
            self.sheet_diagnostics.append(
                {
                    "sheet_name": sheet_name,
                    "raw_rows": int(len(raw_df)),
                    "rows_after_clean": int(len(cleaned_df)),
                    "columns": [str(c) for c in clean_input_df.columns],
                    "classification": sheet_type,
                    "mapping": {k: v for k, v in mapping.items() if v},
                    "confidence": int(round(score)),
                    "warnings": clean_warnings,
                }
            )

            if sheet_type not in {"IGNORE", "ANALYTICS_REFERENCE"}:
                sheet_confidences.append(float(score))

            if clean_warnings:
                for warning in clean_warnings:
                    self.data_quality_report.append(f"{sheet_name}: {warning}")

            self.data_quality_report.append(
                f"Sheet '{sheet_name}' classified as {sheet_type} (confidence={int(round(score))})"
            )

        if not self.classified_sheets["TRANSACTION"]:
            self.warnings.append("No transaction sheet detected. Metrics may be empty.")

        self.confidence_score = round(float(np.mean(sheet_confidences)), 2) if sheet_confidences else 0.0
        return self.classified_sheets

    def get_bundle(self) -> Dict[str, Any]:
        sheet_previews = self._build_sheet_previews(preview_limit=300)
        return {
            "sheets": {
                "TRANSACTION": self.classified_sheets["TRANSACTION"],
                "PRODUCT_MASTER": self.classified_sheets["PRODUCT_MASTER"],
                "CUSTOMER": self.classified_sheets["CUSTOMER_DATA"],
                "INVENTORY_REFERENCE": self.classified_sheets["INVENTORY_REFERENCE"],
                "FIX_DATA": self.classified_sheets["FIX_DATA"],
                "ANALYTICS_REFERENCE": self.classified_sheets["ANALYTICS_REFERENCE"],
                "IGNORE": self.classified_sheets["IGNORE"],
            },
            "total_sheets_loaded": len(self.sheets),
            "confidence_score": self.confidence_score,
            "report": self.data_quality_report,
            "warnings": self.warnings,
            "sheet_diagnostics": self.sheet_diagnostics,
            "sheet_previews": sheet_previews,
        }

    def _build_sheet_previews(self, preview_limit: int = 300) -> List[Dict[str, Any]]:
        previews: List[Dict[str, Any]] = []
        for sheet_type, entries in self.classified_sheets.items():
            for entry in entries:
                df = entry.get("df", pd.DataFrame())
                total_rows = int(len(df))
                sliced_df = df.head(preview_limit).copy() if total_rows > 0 else df
                previews.append(
                    {
                        "sheet_name": entry.get("name", "UNKNOWN_SHEET"),
                        "classification": sheet_type,
                        "columns": [str(c) for c in sliced_df.columns],
                        "rows": self._df_to_json_rows(sliced_df),
                        "total_rows": total_rows,
                        "preview_rows": int(len(sliced_df)),
                        "truncated": bool(total_rows > preview_limit),
                    }
                )
        return previews

    def _df_to_json_rows(self, df: pd.DataFrame) -> List[Dict[str, Any]]:
        if df.empty:
            return []
        records: List[Dict[str, Any]] = []
        for _, row in df.iterrows():
            out_row: Dict[str, Any] = {}
            for col in df.columns:
                value = row[col]
                if pd.isna(value):
                    out_row[str(col)] = None
                elif isinstance(value, pd.Timestamp):
                    out_row[str(col)] = value.isoformat()
                elif isinstance(value, np.generic):
                    out_row[str(col)] = value.item()
                else:
                    out_row[str(col)] = value
            records.append(out_row)
        return records

    def _load_all_sheets(self) -> Dict[str, pd.DataFrame]:
        source_name = str(getattr(self.file_path_or_obj, "name", "") or "").lower()
        excel_exts = (".xlsx", ".xls", ".xlsm", ".xlsb")
        looks_like_excel = source_name.endswith(excel_exts)

        stream = self.file_path_or_obj
        if hasattr(stream, "read") and hasattr(stream, "seek"):
            try:
                current_pos = stream.tell()
            except Exception:
                current_pos = 0
            try:
                stream.seek(0)
                signature = stream.read(8) or b""
                stream.seek(0)
                if isinstance(signature, bytes) and signature.startswith(b"PK"):
                    looks_like_excel = True
            except Exception:
                try:
                    stream.seek(current_pos)
                except Exception:
                    pass

        try:
            sheets = pd.read_excel(self.file_path_or_obj, sheet_name=None)
            if isinstance(sheets, dict) and sheets:
                return {str(k): v for k, v in sheets.items()}
        except Exception as exc:
            # If this looks like an Excel workbook, fail fast instead of mis-parsing binary bytes as CSV.
            if looks_like_excel:
                raise ValueError(f"Excel workbook parsing failed: {exc}")
            logger.info("Excel read failed, attempting CSV fallback: %s", exc)

        csv_errors: List[str] = []
        for encoding in ["utf-8", "utf-8-sig", "latin1"]:
            try:
                df = pd.read_csv(self.file_path_or_obj, encoding=encoding)
                return {"SHEET_1": df}
            except Exception as exc:
                csv_errors.append(f"{encoding}: {exc}")

        raise ValueError(f"Unable to read as Excel or CSV. Details: {' | '.join(csv_errors)}")

    def _pre_clean_structure(self, df: pd.DataFrame) -> pd.DataFrame:
        out = df.copy()
        out.columns = [str(c).strip() for c in out.columns]
        out = self._promote_best_header_row(out)
        out = out.loc[:, ~out.columns.str.contains(r"^Unnamed", case=False, regex=True)]
        out = out.dropna(how="all")
        return out

    def _promote_best_header_row(self, df: pd.DataFrame) -> pd.DataFrame:
        """Promote a likely header row from top rows for messy exports."""
        if df.empty:
            return df

        base_score = self._header_quality([str(c) for c in df.columns])
        best_idx = None
        best_score = base_score

        for idx in range(min(5, len(df))):
            candidate_headers = [str(v).strip() for v in df.iloc[idx].tolist()]
            score = self._header_quality(candidate_headers)
            if score > best_score:
                best_score = score
                best_idx = idx

        if best_idx is not None and (best_score - base_score) >= 25:
            promoted = df.copy().reset_index(drop=True)
            promoted.columns = [str(v).strip() for v in promoted.iloc[best_idx].tolist()]
            promoted = promoted.iloc[best_idx + 1 :].reset_index(drop=True)
            self.data_quality_report.append(
                f"Header row auto-detected at row {best_idx + 1}; promoted for schema inference"
            )
            return promoted

        return df

    def _header_quality(self, columns: List[str]) -> float:
        aliases: List[str] = []
        for targets in self.SHEET_TARGETS.values():
            for alias_list in targets.values():
                aliases.extend(alias_list)

        scores: List[float] = []
        for col in columns:
            normalized = self._normalize_token(str(col))
            if not normalized or normalized in {"nan", "none"}:
                continue
            best = max(self._similarity(normalized, self._normalize_token(alias)) for alias in aliases)
            scores.append(best)

        if not scores:
            return 0.0

        strong_matches = sum(1 for score in scores if score >= self.FUZZY_THRESHOLD)
        return (strong_matches * 15.0) + float(np.mean(scores))

    def _classify_sheet(self, df: pd.DataFrame, sheet_name: str) -> Tuple[str, Dict[str, str], float]:
        hinted_type = self._detect_sheet_type_by_name(sheet_name)

        if hinted_type == "ANALYTICS_REFERENCE":
            return "ANALYTICS_REFERENCE", {}, 95.0

        if hinted_type and hinted_type in self.SHEET_TARGETS:
            hinted_mapping, hinted_score = self._map_columns(df.columns.tolist(), self.SHEET_TARGETS[hinted_type])
            if self._is_valid_classification(hinted_type, hinted_mapping):
                return hinted_type, hinted_mapping, max(88.0, hinted_score)

        best_type = "IGNORE"
        best_mapping: Dict[str, str] = {}
        best_score = 0.0

        for sheet_type, targets in self.SHEET_TARGETS.items():
            mapping, coverage_score = self._map_columns(df.columns.tolist(), targets)
            if not self._is_valid_classification(sheet_type, mapping):
                continue
            if coverage_score > best_score:
                best_type = sheet_type
                best_mapping = mapping
                best_score = coverage_score

        # Fallback: try value-pattern based transaction inference for messy sheets.
        if best_type == "IGNORE":
            heuristic_mapping, heuristic_score = self._heuristic_transaction_mapping(df)
            if heuristic_mapping:
                best_type = "TRANSACTION"
                best_mapping = heuristic_mapping
                best_score = max(best_score, heuristic_score)
                self.data_quality_report.append(
                    "Heuristic transaction classification applied due to ambiguous headers"
                )

        return best_type, best_mapping, best_score

    def _detect_sheet_type_by_name(self, sheet_name: str) -> str:
        normalized = self._normalize_token(str(sheet_name))
        if not normalized:
            return ""

        for sheet_type, hints in self.SHEET_NAME_HINTS.items():
            for hint in hints:
                if self._normalize_token(hint) in normalized:
                    return sheet_type
        return ""

    def _heuristic_transaction_mapping(self, df: pd.DataFrame) -> Tuple[Dict[str, str], float]:
        columns = list(df.columns)
        if not columns:
            return {}, 0.0

        date_col = None
        qty_col = None
        product_col = None
        type_col = None

        best_date_ratio = 0.0
        best_numeric_ratio = 0.0
        best_product_score = 0.0
        best_type_ratio = 0.0

        type_tokens = {"IN", "OUT", "SALE", "PURCHASE", "CREDIT", "DEBIT", "RETURN"}

        for col in columns:
            series = df[col]
            non_null = series.dropna()
            if non_null.empty:
                continue

            # Date candidacy
            # Parse using fast vectorized pd.to_datetime to avoid severe performance degradation on large datasets.
            # Take a sample for inference if the dataset is large.
            sample_size = min(len(non_null), 1000)
            sample = non_null.head(sample_size)
            import warnings
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                parsed_dates = pd.to_datetime(sample.astype(str), errors="coerce")
            
            date_ratio = float(parsed_dates.notna().mean())
            if date_ratio > best_date_ratio and date_ratio >= 0.5:
                best_date_ratio = date_ratio
                date_col = col

            # Numeric candidacy
            numeric_vals = pd.to_numeric(non_null, errors="coerce")
            numeric_ratio = float(numeric_vals.notna().mean())
            if numeric_ratio > best_numeric_ratio and numeric_ratio >= 0.6:
                best_numeric_ratio = numeric_ratio
                qty_col = col

            # Type candidacy from value tokens
            upper_values = non_null.astype(str).str.upper().str.strip()
            token_hits = upper_values.isin(type_tokens).mean()
            if float(token_hits) > best_type_ratio and float(token_hits) >= 0.3:
                best_type_ratio = float(token_hits)
                type_col = col

            # Product candidacy: text-like with moderate uniqueness
            if numeric_ratio < 0.4 and date_ratio < 0.4:
                distinct_ratio = float(non_null.astype(str).nunique() / max(1, len(non_null)))
                product_score = 1.0 - abs(distinct_ratio - 0.5)
                if product_score > best_product_score:
                    best_product_score = product_score
                    product_col = col

        if not product_col or not qty_col:
            return {}, 0.0

        mapping = {
            "date": date_col,
            "product": product_col,
            "quantity": qty_col,
            "type": type_col,
            "price": None,
            "customer": None,
        }
        confidence = 60.0 + (best_numeric_ratio * 20.0) + (best_date_ratio * 10.0) + (best_type_ratio * 10.0)
        return mapping, min(89.0, confidence)

    def _map_columns(self, columns: List[str], targets: Dict[str, List[str]]) -> Tuple[Dict[str, str], float]:
        mapping: Dict[str, str] = {}
        used_columns = set()
        matched_scores: List[float] = []

        for canonical_name, aliases in targets.items():
            best_col = None
            best_score = 0.0

            for col in columns:
                if col in used_columns:
                    continue
                score = self._best_alias_score(str(col), aliases)
                if score > best_score:
                    best_score = score
                    best_col = col

            if best_col is not None and best_score >= self.FUZZY_THRESHOLD:
                mapping[canonical_name] = best_col
                matched_scores.append(best_score)
                used_columns.add(best_col)
            else:
                mapping[canonical_name] = None

        coverage = (sum(matched_scores) / len(targets)) if targets else 0.0
        return mapping, coverage

    def _best_alias_score(self, column_name: str, aliases: List[str]) -> float:
        normalized_col = self._normalize_token(column_name)
        return max(self._similarity(normalized_col, self._normalize_token(alias)) for alias in aliases)

    def _normalize_token(self, value: str) -> str:
        value = value or ""
        value = value.strip().lower()
        value = re.sub(r"[^a-z0-9]+", " ", value)
        return re.sub(r"\s+", " ", value).strip()

    def _similarity(self, left: str, right: str) -> float:
        if not left or not right:
            return 0.0
        seq_score = SequenceMatcher(None, left, right).ratio() * 100
        left_tokens = set(left.split())
        right_tokens = set(right.split())
        token_overlap = 0.0
        if left_tokens and right_tokens:
            token_overlap = (len(left_tokens & right_tokens) / len(left_tokens | right_tokens)) * 100
        if left in right or right in left:
            seq_score = max(seq_score, 85.0)
        return max(seq_score, token_overlap)

    def _is_valid_classification(self, sheet_type: str, mapping: Dict[str, str]) -> bool:
        if sheet_type == "TRANSACTION":
            return bool(mapping.get("product") and mapping.get("quantity"))
        if sheet_type == "PRODUCT_MASTER":
            return bool(mapping.get("product") and (mapping.get("price") or mapping.get("cost") or mapping.get("category")))
        if sheet_type == "CUSTOMER_DATA":
            return bool(mapping.get("customer") and (mapping.get("phone") or mapping.get("email") or mapping.get("address")))
        if sheet_type == "INVENTORY_REFERENCE":
            return bool(mapping.get("product") and mapping.get("stock"))
        if sheet_type == "FIX_DATA":
            return bool(
                (mapping.get("source_party") and mapping.get("target_party"))
                or (mapping.get("source_product") and mapping.get("target_product"))
            )
        if sheet_type == "ANALYTICS_REFERENCE":
            return True
        return False

    def _clean_sheet(
        self,
        df: pd.DataFrame,
        mapping: Dict[str, str],
        sheet_type: str,
    ) -> Tuple[pd.DataFrame, List[str]]:
        out = df.copy()
        warnings: List[str] = []

        out = out.dropna(how="all")
        out = out.loc[:, ~out.columns.str.contains(r"^Unnamed", case=False, regex=True)]

        str_like_cols = out.select_dtypes(include=["object", "string"]).columns.tolist()
        for col in str_like_cols:
            out[col] = out[col].astype(str).str.strip()
            out[col] = out[col].replace({"": np.nan, "NONE": np.nan, "NAN": np.nan})

        if sheet_type == "TRANSACTION":
            date_col = mapping.get("date")
            qty_col = mapping.get("quantity")
            product_col = mapping.get("product")
            price_col = mapping.get("price")
            customer_col = mapping.get("customer")
            type_col = mapping.get("type")
            location_col = mapping.get("location")

            if date_col:
                out[date_col] = pd.to_datetime(out[date_col], errors="coerce")
            if qty_col:
                out[qty_col] = pd.to_numeric(out[qty_col], errors="coerce")
            if price_col:
                out[price_col] = pd.to_numeric(out[price_col], errors="coerce")

            if product_col:
                out[product_col] = out[product_col].astype(str).str.upper().str.strip()
            if customer_col:
                out[customer_col] = out[customer_col].astype(str).str.upper().str.strip()
            if type_col:
                out[type_col] = out[type_col].astype(str).str.upper().str.strip()
            if location_col:
                out[location_col] = out[location_col].astype(str).str.upper().str.strip()

            before = len(out)
            if product_col:
                out = out[out[product_col].notna() & (out[product_col] != "")]
            if qty_col:
                out = out[out[qty_col].notna()]
            removed = before - len(out)
            if removed > 0:
                warnings.append(f"Dropped {removed} invalid transaction rows (missing product or quantity)")

        elif sheet_type == "PRODUCT_MASTER":
            product_col = mapping.get("product")
            if product_col:
                out[product_col] = out[product_col].astype(str).str.upper().str.strip()
                before = len(out)
                out = out[out[product_col].notna() & (out[product_col] != "")]
                removed = before - len(out)
                if removed > 0:
                    warnings.append(f"Dropped {removed} product rows with missing product key")

            for key in ["price", "cost"]:
                col = mapping.get(key)
                if col:
                    out[col] = pd.to_numeric(out[col], errors="coerce")

        elif sheet_type == "INVENTORY_REFERENCE":
            product_col = mapping.get("product")
            stock_col = mapping.get("stock")
            location_col = mapping.get("location")
            price_col = mapping.get("price")

            if product_col:
                out[product_col] = out[product_col].astype(str).str.upper().str.strip()
            if location_col:
                out[location_col] = out[location_col].astype(str).str.upper().str.strip()
            if stock_col:
                out[stock_col] = pd.to_numeric(out[stock_col], errors="coerce")
            if price_col:
                out[price_col] = pd.to_numeric(out[price_col], errors="coerce")

            before = len(out)
            if product_col:
                out = out[out[product_col].notna() & (out[product_col] != "")]
            if stock_col:
                out = out[out[stock_col].notna()]
            removed = before - len(out)
            if removed > 0:
                warnings.append(f"Dropped {removed} inventory rows with missing product or stock")

        elif sheet_type == "FIX_DATA":
            for key in ["source_party", "target_party", "source_product", "target_product"]:
                col = mapping.get(key)
                if col:
                    out[col] = out[col].astype(str).str.upper().str.strip()

            before = len(out)
            valid_party = bool(mapping.get("source_party") and mapping.get("target_party"))
            valid_product = bool(mapping.get("source_product") and mapping.get("target_product"))
            if valid_party:
                out = out[
                    out[mapping["source_party"]].notna()
                    & (out[mapping["source_party"]] != "")
                    & out[mapping["target_party"]].notna()
                    & (out[mapping["target_party"]] != "")
                ]
            if valid_product:
                out = out[
                    out[mapping["source_product"]].notna()
                    & (out[mapping["source_product"]] != "")
                    & out[mapping["target_product"]].notna()
                    & (out[mapping["target_product"]] != "")
                ]
            removed = before - len(out)
            if removed > 0:
                warnings.append(f"Dropped {removed} invalid FIX-DATA mapping rows")

        elif sheet_type == "ANALYTICS_REFERENCE":
            # Keep reference sheet rows for diagnostics, but don't enforce strict schema.
            pass

        elif sheet_type == "CUSTOMER_DATA":
            customer_col = mapping.get("customer")
            if customer_col:
                out[customer_col] = out[customer_col].astype(str).str.upper().str.strip()
                before = len(out)
                out = out[out[customer_col].notna() & (out[customer_col] != "")]
                removed = before - len(out)
                if removed > 0:
                    warnings.append(f"Dropped {removed} customer rows with missing customer key")

        dedupe_before = len(out)
        out = out.drop_duplicates()
        dedupe_removed = dedupe_before - len(out)
        if dedupe_removed > 0:
            warnings.append(f"Removed {dedupe_removed} duplicate rows")

        out = out.reset_index(drop=True)
        return out, warnings
