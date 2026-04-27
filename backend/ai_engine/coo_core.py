from typing import Any, Dict, List, Tuple

import numpy as np
import pandas as pd


class COOCore:
    """
    Production-grade AI COO core.

    Phases covered:
    - 5: transaction normalization
    - 6: multi-sheet merging
    - 7: core business calculations
    - 8: advanced analytics
    - 9: customer analytics
    - 10: AI decision engine
    - 11: validation and confidence gating
    """

    def __init__(self, ingestion_bundle: Dict[str, Any]):
        self.bundle = ingestion_bundle.get("sheets", {})
        self.base_confidence = float(ingestion_bundle.get("confidence_score", 0))
        self.quality_messages: List[str] = list(ingestion_bundle.get("report", []))
        self.global_warnings: List[str] = list(ingestion_bundle.get("warnings", []))

        self.normalized_df = pd.DataFrame(
            columns=[
                "product",
                "customer",
                "location",
                "date",
                "quantity",
                "transaction_type",
                "price",
                "source_sheet",
                "type_warning",
            ]
        )

        self.validation_counters = {
            "total_transaction_rows": 0,
            "normalized_rows": 0,
            "unknown_type_rows": 0,
            "invalid_rows_skipped": 0,
            "product_join_miss": 0,
            "customer_join_miss": 0,
            "duplicates_removed": 0,
            "inconsistencies": 0,
            "missing_mappings": 0,
            "negative_stock_adjustments": 0,
            "negative_stock_units_adjusted": 0.0,
        }

        self.analysis_results: Dict[str, Any] = {
            "products_analysis": [],
            "customer_analysis": [],
            "sheet_analysis": [],
            "products": [],
            "customers": [],
            "demand_forecast": [],
            "past_sales_daily": [],
            "past_sales_weekly": [],
            "inventory_summary": {},
            "inventory_by_location": [],
            "stock_analysis": {},
            "backend_analytics": {},
            "stock_in_analysis": {},
            "sales_summary": {},
            "forecast_summary": {},
            "summary": {},
            "recommendations": [],
            "alerts": [],
            "consistency_checks": [],
            "debug_trace": {},
            "data_quality_report": self.quality_messages,
            "confidence_score": 0,
            "confidence_label": "LOW",
        }

    def process(self) -> Dict[str, Any]:
        self._normalize_transactions()
        self._merge_master_data()
        self._build_sheet_analysis()
        self._calculate_product_metrics()
        self._calculate_customer_metrics()
        self._build_backend_analytics()
        self._build_stock_in_analysis()
        self._run_consistency_checks()
        self._build_unified_sections()
        self._build_debug_trace()
        self._generate_alerts()
        self._validate_and_score_confidence()
        return self.analysis_results

    def _build_debug_trace(self) -> None:
        sheet_detection_logs: List[Dict[str, Any]] = []
        for category, sheets in self.bundle.items():
            for sheet in sheets or []:
                sheet_detection_logs.append(
                    {
                        "sheet_name": sheet.get("name", "UNKNOWN_SHEET"),
                        "detected_type": category,
                        "mapping": sheet.get("mapping", {}),
                        "confidence": sheet.get("score"),
                        "warnings": sheet.get("warnings", []),
                        "rows": int(len(sheet.get("df", pd.DataFrame()))),
                    }
                )

        self.analysis_results["debug_trace"] = {
            "sheet_detection_logs": sheet_detection_logs,
            "row_level_classification_logs": [
                {
                    "product": row.get("product"),
                    "risk_level": row.get("risk_level"),
                    "movement_class": row.get("movement_class"),
                    "days_to_stockout": row.get("days_to_stockout"),
                    "reason": row.get("WHY"),
                }
                for row in (self.analysis_results.get("products_analysis", []) or [])
            ],
            "mapping_decisions": {
                "unknown_type_rows": int(self.validation_counters.get("unknown_type_rows", 0)),
                "missing_mappings": int(self.validation_counters.get("missing_mappings", 0)),
                "duplicates_removed": int(self.validation_counters.get("duplicates_removed", 0)),
                "invalid_rows_skipped": int(self.validation_counters.get("invalid_rows_skipped", 0)),
                "negative_stock_adjustments": int(self.validation_counters.get("negative_stock_adjustments", 0)),
            },
            "skipped_row_reasons": [
                msg
                for msg in (self.analysis_results.get("data_quality_report", []) or [])
                if any(token in str(msg).lower() for token in ["skipped", "missing", "dropped", "unknown"])
            ],
        }

    def _build_unified_sections(self) -> None:
        products_analysis = self.analysis_results.get("products_analysis", []) or []
        customer_analysis = self.analysis_results.get("customer_analysis", []) or []

        products: List[Dict[str, Any]] = []
        for idx, p in enumerate(products_analysis):
            daily_sales = float(p.get("daily_sales") or p.get("velocity") or 0.0)
            products.append(
                {
                    "id": idx + 1,
                    "sku": p.get("product"),
                    "name": p.get("product"),
                    "product": p.get("product"),
                    "risk": p.get("risk_level", "LOW"),
                    "current_stock": float(p.get("current_stock", 0.0)),
                    "on_hand": float(p.get("computed_stock_raw", p.get("current_stock", 0.0))),
                    "daily_demand": float(p.get("daily_demand", daily_sales)),
                    "sales_velocity": float(p.get("sales_velocity", daily_sales)),
                    "total_sales": float(p.get("total_sales", 0.0)),
                    "days_to_stockout": p.get("days_to_stockout"),
                    "days_to_stock": p.get("days_to_stockout"),
                    "category": p.get("category", "UNKNOWN"),
                    "unit_price": float(p.get("unit_price", p.get("price", 0.0)) or 0.0),
                    "reason": p.get("WHY", p.get("why", "")),
                    "recommended_action": p.get("WHAT", p.get("what", "")),
                    "action_plan": p.get("HOW", p.get("how", [])),
                }
            )

        customers: List[Dict[str, Any]] = []
        for idx, c in enumerate(customer_analysis):
            frequency = int(c.get("frequency", 0) or 0)
            low_activity = bool(c.get("low_activity", False))
            intensity_level = "HEALTHY"
            intensity_label = "ACTIVE"
            risk = "ACTIVE"
            if low_activity and frequency <= 0:
                intensity_level = "LIYA_HI_NAHI"
                intensity_label = "NO PURCHASE"
                risk = "CHURN_RISK"
            elif low_activity and frequency <= 1:
                intensity_level = "BAHUT_KAM"
                intensity_label = "VERY LOW"
                risk = "CHURN_RISK"
            elif low_activity:
                intensity_level = "THODA_KAM"
                intensity_label = "LOW"
                risk = "WATCH"

            customers.append(
                {
                    "id": idx + 1,
                    "name": c.get("customer"),
                    "customer_name": c.get("customer"),
                    "customer_id": c.get("customer"),
                    "company": c.get("customer"),
                    "email": c.get("email"),
                    "phone": c.get("phone"),
                    "address": c.get("address"),
                    "total_purchase": float(c.get("total_purchase", 0.0)),
                    "frequency": frequency,
                    "total_units": float(c.get("total_units", 0.0)),
                    "last_order_date": c.get("last_purchase_date") or c.get("last_order_date"),
                    "last_purchase_date": c.get("last_purchase_date") or c.get("last_order_date"),
                    "is_top_customer_80_20": bool(c.get("is_top_customer_80_20", False)),
                    "low_activity": low_activity,
                    "monthly_breakdown": c.get("monthly_breakdown", []),
                    "weekly_breakdown": c.get("weekly_breakdown", []),
                    "intensity_level": intensity_level,
                    "intensity_label": intensity_label,
                    "risk": risk,
                    "reason": "Low activity detected" if low_activity else "Customer is active",
                }
            )

        self.analysis_results["products"] = products
        self.analysis_results["customers"] = customers

        stock = self.analysis_results.get("stock_analysis", {}) or {}
        self.analysis_results["summary"] = {
            "out_of_stock": int(stock.get("out_of_stock_items", 0)),
            "low_stock": int(stock.get("low_stock_items", 0)),
            "deadstock": int(stock.get("deadstock_items", 0)),
            "overstock": int(stock.get("overstock_items", 0)),
            "healthy": int(stock.get("healthy_items", 0)),
        }

        inv = self.analysis_results.get("inventory_summary", {}) or {}
        total_revenue = sum(float(p.get("total_sales", 0.0)) * float(p.get("unit_price", 0.0)) for p in products)
        total_sales_units = float(inv.get("total_sales", inv.get("total_sales_units", 0.0)) or 0.0)
        self.analysis_results["sales_summary"] = {
            "total_sales": round(total_sales_units, 4),
            "total_revenue": round(total_revenue, 2),
            "trend": self._overall_sales_trend(),
        }

        self.analysis_results["demand_forecast"] = self._build_demand_forecast(products)
        daily_sales_rows, weekly_sales_rows = self._build_past_sales_series()
        self.analysis_results["past_sales_daily"] = daily_sales_rows
        self.analysis_results["past_sales_weekly"] = weekly_sales_rows
        forecast_rows = self.analysis_results["demand_forecast"]
        self.analysis_results["forecast_summary"] = {
            "total_predicted_demand": round(sum(float(r.get("predicted_demand", 0.0)) for r in forecast_rows), 2),
            "daily_pattern": self._overall_sales_trend(),
        }

        # Backward-compatible aliases consumed by existing pages.
        if "total_current_stock" in inv and "total_stock" not in inv:
            inv["total_stock"] = inv["total_current_stock"]
        if "total_sales" in inv and "total_sales_units" not in inv:
            inv["total_sales_units"] = inv["total_sales"]
        inv["total_revenue"] = round(total_revenue, 2)
        self.analysis_results["inventory_summary"] = inv

    def _build_demand_forecast(self, products: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not products:
            return []

        top_products = sorted(products, key=lambda p: float(p.get("daily_demand", 0.0)), reverse=True)[:10]
        forecast_rows: List[Dict[str, Any]] = []
        for p in top_products:
            daily = max(0.0, float(p.get("daily_demand", 0.0)))
            for week_idx in range(1, 5):
                predicted = round(daily * 7, 2)
                forecast_rows.append(
                    {
                        "product": p.get("product"),
                        "sku": p.get("sku"),
                        "date": f"W+{week_idx}",
                        "predicted_demand": predicted,
                        "lower_bound": round(predicted * 0.9, 2),
                        "upper_bound": round(predicted * 1.1, 2),
                        "production": round(predicted * 1.15, 2),
                    }
                )

        return forecast_rows

    def _overall_sales_trend(self) -> str:
        if self.normalized_df.empty:
            return "NO_DATA"

        df = self.normalized_df.copy()
        df = df[df["transaction_type"] == "SALE"]
        if df.empty:
            return "NO_SALES"

        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        df = df.dropna(subset=["date"])
        if df.empty:
            return "UNKNOWN"

        daily = df.groupby(df["date"].dt.date)["quantity"].sum().reset_index()
        if len(daily) < 3:
            return "STABLE"

        x = np.arange(len(daily), dtype=float)
        y = daily["quantity"].astype(float).to_numpy()
        slope = float(np.polyfit(x, y, deg=1)[0])
        if slope > 0.05:
            return "UPWARD"
        if slope < -0.05:
            return "DOWNWARD"
        return "STABLE"

    def _build_past_sales_series(self) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        if self.normalized_df.empty:
            return [], []

        df = self.normalized_df.copy()
        df = df[df["transaction_type"] == "SALE"]
        if df.empty:
            return [], []

        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        df = df.dropna(subset=["date"])
        if df.empty:
            return [], []

        daily = (
            df.groupby(df["date"].dt.date)["quantity"]
            .sum()
            .reset_index()
            .rename(columns={"quantity": "actual"})
        )
        daily_rows = [
            {
                "date": str(row["date"]),
                "actual": round(float(row["actual"]), 4),
            }
            for _, row in daily.iterrows()
        ]

        weekly_df = df.copy()
        weekly_df["week_start"] = weekly_df["date"].dt.to_period("W").apply(lambda p: p.start_time.date())
        weekly = (
            weekly_df.groupby("week_start")["quantity"]
            .sum()
            .reset_index()
            .rename(columns={"week_start": "date", "quantity": "actual"})
        )
        weekly_rows = [
            {
                "date": str(row["date"]),
                "actual": round(float(row["actual"]), 4),
            }
            for _, row in weekly.iterrows()
        ]

        return daily_rows, weekly_rows

    def _build_stock_in_analysis(self) -> None:
        template = {
            "total_stock_in_units": 0.0,
            "previous_months_total_stock_in_units": 0.0,
            "transaction_count": 0,
            "monthly_stock_in": [],
            "previous_months_breakdown": [],
            "stock_in_by_date": [],
            "first_stock_in_date": None,
            "latest_stock_in_date": None,
        }

        if self.normalized_df.empty:
            self.analysis_results["stock_in_analysis"] = template
            return

        df = self.normalized_df.copy()
        df = df[df["transaction_type"] == "PURCHASE"].copy()
        if df.empty:
            self.analysis_results["stock_in_analysis"] = template
            return

        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        df = df.dropna(subset=["date"])
        if df.empty:
            self.analysis_results["stock_in_analysis"] = template
            return

        df["month"] = df["date"].dt.to_period("M").astype(str)

        monthly = (
            df.groupby("month", as_index=False)
            .agg(
                stock_in_units=("quantity", "sum"),
                transaction_count=("quantity", "size"),
                active_days=("date", lambda x: x.dt.date.nunique()),
            )
            .sort_values("month")
        )

        df["stock_in_date"] = df["date"].dt.date
        daily = (
            df.groupby("stock_in_date", as_index=False)
            .agg(stock_in_units=("quantity", "sum"), transaction_count=("quantity", "size"))
            .sort_values("stock_in_date")
        )

        current_month = pd.Timestamp.today().to_period("M")
        previous_df = df[df["date"].dt.to_period("M") < current_month].copy()
        previous_months_breakdown = []
        if not previous_df.empty:
            previous_monthly = (
                previous_df.groupby("month", as_index=False)["quantity"]
                .sum()
                .rename(columns={"quantity": "stock_in_units"})
                .sort_values("month")
            )
            previous_months_breakdown = [
                {
                    "month": str(row["month"]),
                    "stock_in_units": round(float(row["stock_in_units"]), 4),
                }
                for _, row in previous_monthly.iterrows()
            ]

        self.analysis_results["stock_in_analysis"] = {
            "total_stock_in_units": round(float(df["quantity"].sum()), 4),
            "previous_months_total_stock_in_units": round(float(previous_df["quantity"].sum()) if not previous_df.empty else 0.0, 4),
            "transaction_count": int(len(df)),
            "monthly_stock_in": [
                {
                    "month": str(row["month"]),
                    "stock_in_units": round(float(row["stock_in_units"]), 4),
                    "transaction_count": int(row["transaction_count"]),
                    "active_days": int(row["active_days"]),
                }
                for _, row in monthly.iterrows()
            ],
            "previous_months_breakdown": previous_months_breakdown,
            "stock_in_by_date": [
                {
                    "date": str(row["stock_in_date"]),
                    "stock_in_units": round(float(row["stock_in_units"]), 4),
                    "transaction_count": int(row["transaction_count"]),
                }
                for _, row in daily.iterrows()
            ],
            "first_stock_in_date": str(df["date"].min().date()),
            "latest_stock_in_date": str(df["date"].max().date()),
        }

    def _build_sheet_analysis(self) -> None:
        summary_rows: List[Dict[str, Any]] = []

        # Include all detected sheets, including ignored ones, for transparency.
        for category in [
            "TRANSACTION",
            "PRODUCT_MASTER",
            "CUSTOMER",
            "INVENTORY_REFERENCE",
            "FIX_DATA",
            "ANALYTICS_REFERENCE",
            "IGNORE",
        ]:
            for sheet in self.bundle.get(category, []) or []:
                name = sheet.get("name", "UNKNOWN_SHEET")
                raw_rows = int(len(sheet.get("df", pd.DataFrame())))
                summary_rows.append(
                    {
                        "sheet_name": name,
                        "sheet_type": category,
                        "raw_rows": raw_rows,
                        "normalized_rows": 0,
                        "purchase_rows": 0,
                        "sale_rows": 0,
                        "return_rows": 0,
                        "unknown_rows": 0,
                        "contributed_to_final_analysis": False,
                    }
                )

        if not self.normalized_df.empty:
            per_sheet_txn = (
                self.normalized_df.groupby(["source_sheet", "transaction_type"]) ["product"]
                .count()
                .reset_index(name="count")
            )
            total_by_sheet = self.normalized_df.groupby("source_sheet")["product"].count().to_dict()

            row_map = {row["sheet_name"]: row for row in summary_rows}
            for _, rec in per_sheet_txn.iterrows():
                source = rec["source_sheet"]
                txn_type = rec["transaction_type"]
                count = int(rec["count"])
                target = row_map.get(source)
                if not target:
                    continue
                if txn_type == "PURCHASE":
                    target["purchase_rows"] = count
                elif txn_type == "SALE":
                    target["sale_rows"] = count
                elif txn_type == "RETURN":
                    target["return_rows"] = count
                elif txn_type == "UNKNOWN":
                    target["unknown_rows"] = count

            for sheet_name, normalized_count in total_by_sheet.items():
                target = row_map.get(sheet_name)
                if not target:
                    continue
                target["normalized_rows"] = int(normalized_count)
                target["contributed_to_final_analysis"] = int(normalized_count) > 0

        self.analysis_results["sheet_analysis"] = summary_rows

    def _normalize_transactions(self) -> None:
        transaction_sheets = self.bundle.get("TRANSACTION", []) or []
        if not transaction_sheets:
            self.analysis_results["data_quality_report"].append("No transaction sheets available")
            return

        normalized_parts: List[pd.DataFrame] = []
        party_fix_map, product_fix_map = self._build_fix_mappings()

        for sheet in transaction_sheets:
            df = sheet.get("df", pd.DataFrame()).copy()
            mapping = sheet.get("mapping", {})
            sheet_name = sheet.get("name", "UNKNOWN_SHEET")
            self.validation_counters["total_transaction_rows"] += len(df)

            required_fields = ["product", "quantity"]
            missing_required = [f for f in required_fields if not mapping.get(f)]
            if missing_required:
                self.validation_counters["missing_mappings"] += len(missing_required)
                self.analysis_results["data_quality_report"].append(
                    f"{sheet_name}: Missing required mappings {missing_required}; skipped"
                )
                continue

            std = pd.DataFrame()
            std["product"] = df[mapping["product"]].astype(str).str.upper().str.strip()
            std["customer"] = (
                df[mapping["customer"]].astype(str).str.upper().str.strip()
                if mapping.get("customer")
                else "UNKNOWN"
            )
            std["location"] = (
                df[mapping["location"]].astype(str).str.upper().str.strip()
                if mapping.get("location")
                else "UNKNOWN"
            )
            std["date"] = (
                pd.to_datetime(df[mapping["date"]], errors="coerce")
                if mapping.get("date")
                else pd.NaT
            )
            std["quantity"] = pd.to_numeric(df[mapping["quantity"]], errors="coerce")
            std["price"] = (
                pd.to_numeric(df[mapping["price"]], errors="coerce")
                if mapping.get("price")
                else np.nan
            )
            
            raw_type = (
                df[mapping["type"]].astype(str).str.upper().str.strip()
                if mapping.get("type")
                else pd.Series("", index=df.index)
            )
            std["source_sheet"] = sheet_name

            # Vectorized Transaction Type Mapping
            std["transaction_type"] = "UNKNOWN"
            std["type_warning"] = "Unrecognized transaction type"

            # 1. Fundamental logic (Qty-based)
            purchase_mask = std["quantity"] < 0
            sale_mask = std["quantity"] > 0
            
            std.loc[purchase_mask, "transaction_type"] = "PURCHASE"
            std.loc[purchase_mask, "type_warning"] = "Mapped from custom logic: Negative Qty = STOCK IN"
            
            std.loc[sale_mask, "transaction_type"] = "SALE"
            std.loc[sale_mask, "type_warning"] = "Mapped from custom logic: Positive Qty = STOCK OUT"

            # 2. Text-based logic for remaining UNKNOWNs (where qty was 0 or nan)
            # Or if we want to respect text even if qty is present (business preference)
            # In this business logic, Qty always wins if non-zero.
            
            # For rows where Qty was 0 or NaN, try text mapping
            text_mask = (std["transaction_type"] == "UNKNOWN")
            if text_mask.any():
                sanitized = raw_type.str.replace(r"[/-]", " ", regex=True).str.replace(r"\s+", " ", regex=True).str.strip()
                
                in_mask = sanitized.str.contains(r"\bIN\b|PURCHASE|INWARD|STOCK IN", regex=True)
                out_mask = sanitized.str.contains(r"\bOUT\b|SALE|OUTWARD|STOCK OUT", regex=True)
                ret_mask = sanitized.str.contains(r"RETURN", regex=True)
                
                std.loc[text_mask & in_mask, "transaction_type"] = "PURCHASE"
                std.loc[text_mask & in_mask, "type_warning"] = ""
                
                std.loc[text_mask & out_mask, "transaction_type"] = "SALE"
                std.loc[text_mask & out_mask, "type_warning"] = ""
                
                std.loc[text_mask & ret_mask, "transaction_type"] = "RETURN"
                std.loc[text_mask & ret_mask, "type_warning"] = ""

            std["quantity"] = std["quantity"].astype(float).abs()
            std["price"] = std["price"].astype(float)

            # Cleanup
            before = len(std)
            std = std[std["product"].notna() & (std["product"] != "")]
            std = std[std["quantity"].notna()]
            removed = before - len(std)
            if removed > 0:
                self.validation_counters["invalid_rows_skipped"] += removed
                self.analysis_results["data_quality_report"].append(
                    f"{sheet_name}: skipped {removed} rows missing product or quantity"
                )

            std["product"] = std["product"].replace(product_fix_map)
            std["customer"] = std["customer"].replace(party_fix_map)
            std.loc[std["customer"].isin(["", "NAN", "NONE", "NULL"]), "customer"] = "UNKNOWN"
            std.loc[std["location"].isin(["", "NAN", "NONE", "NULL"]), "location"] = "UNKNOWN"

            unknown_count = int((std["transaction_type"] == "UNKNOWN").sum())
            self.validation_counters["unknown_type_rows"] += unknown_count
            if unknown_count > 0:
                self.analysis_results["data_quality_report"].append(
                    f"{sheet_name}: {unknown_count} rows mapped to UNKNOWN transaction type"
                )

            normalized_parts.append(
                std[
                    [
                        "product",
                        "customer",
                        "location",
                        "date",
                        "quantity",
                        "transaction_type",
                        "price",
                        "source_sheet",
                        "type_warning",
                    ]
                ]
            )

        if normalized_parts:
            self.normalized_df = pd.concat(normalized_parts, ignore_index=True)
            before_dedupe = len(self.normalized_df)
            self.normalized_df = self.normalized_df.drop_duplicates(
                subset=["product", "customer", "date", "quantity", "transaction_type", "price", "source_sheet"]
            ).reset_index(drop=True)
            removed_duplicates = before_dedupe - len(self.normalized_df)
            self.validation_counters["duplicates_removed"] = removed_duplicates
            self.validation_counters["normalized_rows"] = len(self.normalized_df)

            if removed_duplicates > 0:
                self.analysis_results["data_quality_report"].append(
                    f"Removed {removed_duplicates} duplicate normalized transactions"
                )

    def _map_transaction_type(self, raw_type: str, quantity: float) -> Tuple[str, str]:
        qty = float(quantity) if pd.notna(quantity) else np.nan

        # FUNDAMENTAL BUSINESS LOGIC (Overrides text columns):
        # Negative (-) means Stock IN (Available/Purchase/Opening Stock)
        # Positive (+) means Stock OUT (Demand/Sale/Order/Shortage)
        if not pd.isna(qty) and qty != 0:
            if qty < 0:
                return "PURCHASE", "Mapped from custom logic: Negative Qty = STOCK IN"
            elif qty > 0:
                return "SALE", "Mapped from custom logic: Positive Qty = STOCK OUT"

        value = str(raw_type or "").upper().strip()
        sanitized = " ".join(value.replace("/", " ").replace("-", " ").split())
        token_set = set(sanitized.split())

        if {"IN"} & token_set or any(token in sanitized for token in ["PURCHASE", "INWARD", "STOCK IN"]):
            return "PURCHASE", ""
        if {"OUT"} & token_set or any(token in sanitized for token in ["SALE", "OUTWARD", "STOCK OUT"]):
            return "SALE", ""
        if "RETURN" in sanitized:
            return "RETURN", ""

        return "UNKNOWN", "Unrecognized transaction type"

    def _build_fix_mappings(self) -> Tuple[Dict[str, str], Dict[str, str]]:
        party_map: Dict[str, str] = {}
        product_map: Dict[str, str] = {}

        for sheet in self.bundle.get("FIX_DATA", []) or []:
            df = sheet.get("df", pd.DataFrame()).copy()
            mapping = sheet.get("mapping", {})
            if df.empty:
                continue

            source_party_col = mapping.get("source_party")
            target_party_col = mapping.get("target_party")
            if source_party_col and target_party_col:
                pairs = df[[source_party_col, target_party_col]].dropna()
                for _, row in pairs.iterrows():
                    source = str(row[source_party_col]).strip().upper()
                    target = str(row[target_party_col]).strip().upper()
                    if source and target and source not in {"NAN", "NONE", "NULL"}:
                        party_map[source] = target

            source_product_col = mapping.get("source_product")
            target_product_col = mapping.get("target_product")
            if source_product_col and target_product_col:
                pairs = df[[source_product_col, target_product_col]].dropna()
                for _, row in pairs.iterrows():
                    source = str(row[source_product_col]).strip().upper()
                    target = str(row[target_product_col]).strip().upper()
                    if source and target and source not in {"NAN", "NONE", "NULL"}:
                        product_map[source] = target

        return party_map, product_map

    def _merge_master_data(self) -> None:
        if self.normalized_df.empty:
            return

        self.normalized_df["price"] = pd.to_numeric(self.normalized_df["price"], errors="coerce")

        product_master = self._build_product_master_table()
        if not product_master.empty:
            self.normalized_df = self.normalized_df.merge(product_master, on="product", how="left")
            if "master_price" in self.normalized_df.columns:
                self.normalized_df["price"] = self.normalized_df["price"].fillna(self.normalized_df["master_price"])
            if "master_price" in self.normalized_df.columns:
                self.validation_counters["product_join_miss"] = int(self.normalized_df["master_price"].isna().sum())
        else:
            self.normalized_df["master_price"] = np.nan
            self.normalized_df["category"] = np.nan
            self.analysis_results["data_quality_report"].append(
                "No product master sheet merged; product metadata may be incomplete"
            )

        customer_master = self._build_customer_master_table()
        if not customer_master.empty:
            self.normalized_df = self.normalized_df.merge(customer_master, on="customer", how="left")
            self.validation_counters["customer_join_miss"] = int(self.normalized_df["customer_email"].isna().sum())
        else:
            self.normalized_df["customer_phone"] = np.nan
            self.normalized_df["customer_email"] = np.nan
            self.normalized_df["customer_address"] = np.nan
            self.analysis_results["data_quality_report"].append(
                "No customer master sheet merged; customer metadata may be incomplete"
            )

    def _build_product_master_table(self) -> pd.DataFrame:
        records: List[pd.DataFrame] = []
        for sheet in self.bundle.get("PRODUCT_MASTER", []) or []:
            df = sheet.get("df", pd.DataFrame()).copy()
            mapping = sheet.get("mapping", {})
            if df.empty or not mapping.get("product"):
                continue

            merged = pd.DataFrame()
            merged["product"] = df[mapping["product"]].astype(str).str.upper().str.strip()
            merged["master_price"] = (
                pd.to_numeric(df[mapping["price"]], errors="coerce")
                if mapping.get("price")
                else np.nan
            )
            merged["master_cost"] = (
                pd.to_numeric(df[mapping["cost"]], errors="coerce")
                if mapping.get("cost")
                else np.nan
            )
            merged["category"] = (
                df[mapping["category"]].astype(str).str.upper().str.strip()
                if mapping.get("category")
                else np.nan
            )
            records.append(merged)

        for sheet in self.bundle.get("INVENTORY_REFERENCE", []) or []:
            df = sheet.get("df", pd.DataFrame()).copy()
            mapping = sheet.get("mapping", {})
            if df.empty or not mapping.get("product"):
                continue
            merged = pd.DataFrame()
            merged["product"] = df[mapping["product"]].astype(str).str.upper().str.strip()
            merged["master_price"] = (
                pd.to_numeric(df[mapping["price"]], errors="coerce")
                if mapping.get("price")
                else np.nan
            )
            merged["master_cost"] = np.nan
            merged["category"] = np.nan
            records.append(merged)

        if not records:
            return pd.DataFrame(columns=["product", "master_price", "master_cost", "category"])

        out = pd.concat(records, ignore_index=True)
        out = out.dropna(subset=["product"])  # keep only valid keys
        out = out[out["product"] != ""]
        out = out.drop_duplicates(subset=["product"], keep="first")
        return out

    def _build_inventory_reference_table(self) -> pd.DataFrame:
        records: List[pd.DataFrame] = []
        for sheet in self.bundle.get("INVENTORY_REFERENCE", []) or []:
            df = sheet.get("df", pd.DataFrame()).copy()
            mapping = sheet.get("mapping", {})
            product_col = mapping.get("product")
            stock_col = mapping.get("stock")
            if df.empty or not product_col or not stock_col:
                continue

            merged = pd.DataFrame()
            merged["product"] = df[product_col].astype(str).str.upper().str.strip()
            merged["location"] = (
                df[mapping["location"]].astype(str).str.upper().str.strip()
                if mapping.get("location")
                else "UNKNOWN"
            )
            merged["opening_stock"] = pd.to_numeric(df[stock_col], errors="coerce").fillna(0.0)
            merged = merged.dropna(subset=["product"])
            merged = merged[merged["product"] != ""]
            records.append(merged)

        if not records:
            return pd.DataFrame(columns=["product", "location", "opening_stock"])

        out = pd.concat(records, ignore_index=True)
        out["location"] = out["location"].replace({"": "UNKNOWN", "NAN": "UNKNOWN", "NONE": "UNKNOWN", "NULL": "UNKNOWN"})
        out = out.groupby(["product", "location"], as_index=False)["opening_stock"].sum()
        return out

    def _build_customer_master_table(self) -> pd.DataFrame:
        records: List[pd.DataFrame] = []
        for sheet in self.bundle.get("CUSTOMER", []) or []:
            df = sheet.get("df", pd.DataFrame()).copy()
            mapping = sheet.get("mapping", {})
            if df.empty or not mapping.get("customer"):
                continue

            merged = pd.DataFrame()
            merged["customer"] = df[mapping["customer"]].astype(str).str.upper().str.strip()
            merged["customer_phone"] = (
                df[mapping["phone"]].astype(str).str.strip() if mapping.get("phone") else np.nan
            )
            merged["customer_email"] = (
                df[mapping["email"]].astype(str).str.strip() if mapping.get("email") else np.nan
            )
            merged["customer_address"] = (
                df[mapping["address"]].astype(str).str.strip() if mapping.get("address") else np.nan
            )
            records.append(merged)

        if not records:
            return pd.DataFrame(columns=["customer", "customer_phone", "customer_email", "customer_address"])

        out = pd.concat(records, ignore_index=True)
        out = out.dropna(subset=["customer"])  # keep only valid keys
        out = out[out["customer"] != ""]
        out = out.drop_duplicates(subset=["customer"], keep="first")
        return out

    def _calculate_product_metrics(self) -> None:
        if self.normalized_df.empty:
            self.analysis_results["products_analysis"] = []
            self.analysis_results["inventory_summary"] = {
                "total_products": 0,
                "total_transactions": 0,
                "total_purchase_units": 0.0,
                "total_sales_units": 0.0,
                "total_return_units": 0.0,
                "total_current_stock": 0.0,
            }
            self.analysis_results["stock_analysis"] = {
                "out_of_stock_items": 0,
                "low_stock_items": 0,
                "deadstock_items": 0,
                "overstock_items": 0,
                "healthy_items": 0,
            }
            return

        df = self.normalized_df.copy()
        df["date"] = pd.to_datetime(df["date"], errors="coerce")

        opening_inventory = self._build_inventory_reference_table()
        opening_lookup = {}
        opening_counts = {}
        if not opening_inventory.empty:
            for _, row in opening_inventory.iterrows():
                p, l, s = str(row["product"]), str(row["location"]), float(row["opening_stock"])
                opening_lookup[(p, l)] = s
                opening_counts.setdefault(p, []).append(l)

        product_default_loc = {p: locs[0] for p, locs in opening_counts.items() if len(locs) == 1}

        df["resolved_location"] = df["location"].fillna("UNKNOWN").astype(str).str.upper().str.strip()
        impute_mask = (df["resolved_location"] == "UNKNOWN") & df["product"].isin(product_default_loc)
        imputed_unknown_locations = int(impute_mask.sum())
        if imputed_unknown_locations > 0:
            df.loc[impute_mask, "resolved_location"] = df.loc[impute_mask, "product"].map(product_default_loc)

        # Pre-calculate location rollups
        loc_agg = (
            df.groupby(["product", "resolved_location", "transaction_type"])["quantity"]
            .sum()
            .unstack(fill_value=0.0)
            .reset_index()
        )
        for col in ["PURCHASE", "SALE", "RETURN"]:
            if col not in loc_agg.columns:
                loc_agg[col] = 0.0

        loc_lookup = {}
        for _, r in loc_agg.iterrows():
            loc_lookup[(str(r["product"]), str(r["resolved_location"]))] = {
                "PURCHASE": float(r["PURCHASE"]),
                "SALE": float(r["SALE"]),
                "RETURN": float(r["RETURN"]),
            }

        # Pre-calculate daily sales for all products to speed up _sales_trend
        sales_only = df[df["transaction_type"] == "SALE"].dropna(subset=["date"])
        product_daily_sales = {}
        if not sales_only.empty:
            daily_agg = sales_only.groupby([sales_only["product"], sales_only["date"].dt.date])["quantity"].sum().reset_index()
            for p, p_group in daily_agg.groupby("product"):
                product_daily_sales[str(p)] = p_group

        product_rows: List[Dict[str, Any]] = []
        location_rows: List[Dict[str, Any]] = []
        sales_speeds: List[float] = []

        for product, group in df.groupby("product", dropna=True):
            p_str = str(product)
            purchase_qty = float(group.loc[group["transaction_type"] == "PURCHASE", "quantity"].sum())
            sales_qty = float(group.loc[group["transaction_type"] == "SALE", "quantity"].sum())
            return_qty = float(group.loc[group["transaction_type"] == "RETURN", "quantity"].sum())

            opening_stock = float(sum(stock for (prod, _loc), stock in opening_lookup.items() if prod == p_str))
            raw_stock = opening_stock + purchase_qty - sales_qty + return_qty
            current_stock = max(0.0, raw_stock)

            valid_dates = group["date"].dropna()
            active_days = 0
            if not valid_dates.empty:
                active_days = int((valid_dates.max() - valid_dates.min()).days)
            effective_days = max(1, active_days)

            daily_sales = sales_qty / effective_days if sales_qty > 0 else 0.0
            days_to_stockout = (current_stock / daily_sales) if daily_sales > 0 else None

            # Use pre-calculated daily sales for trend
            trend = self._sales_trend(product_daily_sales.get(p_str, pd.DataFrame()))
            return_rate = (return_qty / sales_qty) if sales_qty > 0 else 0.0

            flags = []
            if raw_stock < 0:
                flags.append("SHORTAGE")
            if sales_qty == 0 and current_stock > 0:
                flags.append("DEAD_STOCK")
            if daily_sales > 0:
                sales_speeds.append(daily_sales)

            product_rows.append(
                {
                    "product": p_str,
                    "total_purchase": round(purchase_qty, 4),
                    "total_sales": round(sales_qty, 4),
                    "total_returns": round(return_qty, 4),
                    "opening_stock": round(float(opening_stock), 4),
                    "computed_stock_raw": round(float(raw_stock), 4),
                    "current_stock": round(float(current_stock), 4),
                    "on_hand": round(float(raw_stock), 4),
                    "active_days": int(active_days),
                    "daily_sales": round(float(daily_sales), 6),
                    "daily_demand": round(float(sales_qty), 4),
                    "sales_velocity": round(float(purchase_qty + sales_qty), 4),
                    "days_to_stockout": None if days_to_stockout is None else round(float(days_to_stockout), 2),
                    "return_rate": round(float(return_rate), 6),
                    "sales_trend": trend,
                    "category": self._first_non_null(group, "category", default="UNKNOWN"),
                    "unit_price": self._coalesce_numeric(
                        self._first_non_null(group, "price"),
                        self._first_non_null(group, "master_price"),
                        fallback=0.0,
                    ),
                    "flags": flags,
                }
            )

            p_opening_locs = {loc for (prod, loc) in opening_lookup.keys() if prod == p_str}
            p_txn_locs = {loc for (prod, loc) in loc_lookup.keys() if prod == p_str}
            for location in sorted(p_opening_locs | p_txn_locs):
                metrics = loc_lookup.get((p_str, location), {"PURCHASE": 0.0, "SALE": 0.0, "RETURN": 0.0})
                loc_opening = float(opening_lookup.get((p_str, location), 0.0))
                loc_raw = loc_opening + metrics["PURCHASE"] - metrics["SALE"] + metrics["RETURN"]
                location_rows.append({
                    "product": p_str,
                    "location": location,
                    "opening_stock": round(loc_opening, 4),
                    "purchase_units": round(metrics["PURCHASE"], 4),
                    "sale_units": round(metrics["SALE"], 4),
                    "return_units": round(metrics["RETURN"], 4),
                    "computed_stock_raw": round(loc_raw, 4),
                    "current_stock": max(0.0, round(loc_raw, 4)),
                })

        self._apply_velocity_buckets(product_rows, sales_speeds)

        for row in product_rows:
            decision = self._build_ai_decision(row)
            row.update(decision)
            row["risk"] = row.get("risk_level")
            row["velocity"] = row.get("daily_sales")
            row["why"] = row.get("WHY")
            row["what"] = row.get("WHAT")
            row["how"] = row.get("HOW")

        self.analysis_results["products_analysis"] = product_rows
        self.analysis_results["inventory_by_location"] = location_rows

        if imputed_unknown_locations > 0:
            self.analysis_results["data_quality_report"].append(
                f"Location imputed for {imputed_unknown_locations} transaction rows using opening inventory defaults"
            )

        out_of_stock_count = int(sum(1 for p in product_rows if float(p.get("current_stock", 0)) <= 0))
        low_stock_count = int(
            sum(
                1
                for p in product_rows
                if float(p.get("current_stock", 0)) > 0
                and p.get("movement_class") != "DEAD_STOCK"
                and p.get("days_to_stockout") is not None
                and float(p.get("days_to_stockout", 9999)) <= 7
            )
        )
        deadstock_count = int(
            sum(
                1 for p in product_rows if float(p.get("current_stock", 0)) > 0 and p.get("movement_class") == "DEAD_STOCK"
            )
        )
        overstock_count = int(
            sum(
                1
                for p in product_rows
                if float(p.get("current_stock", 0)) > 0
                and p.get("movement_class") != "DEAD_STOCK"
                if p.get("days_to_stockout") is not None and float(p.get("days_to_stockout", 0)) > 120
            )
        )
        healthy_count = int(max(0, len(product_rows) - (out_of_stock_count + low_stock_count + deadstock_count + overstock_count)))

        self.analysis_results["inventory_summary"] = {
            "total_products": len(product_rows),
            "total_transactions": int(len(self.normalized_df)),
            "total_purchase_units": round(float(sum(p["total_purchase"] for p in product_rows)), 4),
            "total_sales_units": round(float(sum(p["total_sales"] for p in product_rows)), 4),
            "total_sales": round(float(sum(p["total_sales"] for p in product_rows)), 4),
            "total_return_units": round(float(sum(p["total_returns"] for p in product_rows)), 4),
            "total_opening_stock": round(float(sum(p.get("opening_stock", 0.0) for p in product_rows)), 4),
            "total_current_stock": round(float(sum(p["current_stock"] for p in product_rows)), 4),
            "products_with_shortage": int(sum(1 for p in product_rows if "SHORTAGE" in p["flags"])),
            # Backward compatibility metrics (even though they represent shortages now)
            "products_with_negative_stock": int(sum(1 for p in product_rows if "SHORTAGE" in p["flags"])),
            "dead_stock_products": int(sum(1 for p in product_rows if "DEAD_STOCK" in p["flags"])),
            "negative_stock_adjustments": int(self.validation_counters["negative_stock_adjustments"]),
            "negative_stock_units_adjusted": round(float(self.validation_counters["negative_stock_units_adjusted"]), 4),
        }

        self.analysis_results["stock_analysis"] = {
            "out_of_stock_items": out_of_stock_count,
            "low_stock_items": low_stock_count,
            "deadstock_items": deadstock_count,
            "overstock_items": overstock_count,
            "healthy_items": healthy_count,
        }

        priority_rows = [
            p for p in product_rows if p.get("risk_level") in {"CRITICAL", "HIGH", "MEDIUM"}
        ]
        priority_rows = sorted(
            priority_rows,
            key=lambda p: (
                {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2}.get(p.get("risk_level"), 99),
                float(p.get("days_to_stockout") or 99999),
            ),
        )
        self.analysis_results["recommendations"] = [
            f"{row['product']}: {row.get('WHAT', 'Review stock and sales pattern')}"
            for row in priority_rows[:5]
        ]

    def _sales_trend(self, daily_df: pd.DataFrame) -> str:
        if daily_df.empty:
            return "NO_SALES"

        if len(daily_df) < 3:
            return "STABLE"

        x = np.arange(len(daily_df), dtype=float)
        y = daily_df["quantity"].astype(float).to_numpy()
        slope = float(np.polyfit(x, y, deg=1)[0])

        if slope > 0.05:
            return "UPWARD"
        if slope < -0.05:
            return "DOWNWARD"
        return "STABLE"

    def _apply_velocity_buckets(self, product_rows: List[Dict[str, Any]], sales_speeds: List[float]) -> None:
        if not product_rows:
            return

        if sales_speeds:
            fast_threshold = float(np.percentile(sales_speeds, 75))
            slow_threshold = float(np.percentile(sales_speeds, 25))
        else:
            fast_threshold = 0.0
            slow_threshold = 0.0

        for row in product_rows:
            speed = float(row["daily_sales"])
            if speed <= 0:
                row["movement_class"] = "DEAD_STOCK"
            elif speed >= fast_threshold and fast_threshold > 0:
                row["movement_class"] = "FAST_MOVING"
            elif speed <= slow_threshold:
                row["movement_class"] = "SLOW_MOVING"
            else:
                row["movement_class"] = "NORMAL"

    def _build_ai_decision(self, row: Dict[str, Any]) -> Dict[str, Any]:
        stock = float(row["current_stock"])
        raw_stock = float(row.get("computed_stock_raw", stock))
        daily_sales = float(row["daily_sales"])
        days_left = row["days_to_stockout"]
        trend = row["sales_trend"]

        if raw_stock < 0:
            risk = "CRITICAL"
        elif days_left is None and daily_sales == 0:
            risk = "LOW"
        elif days_left is not None and days_left <= 7:
            risk = "HIGH"
        elif days_left is not None and days_left <= 21:
            risk = "MEDIUM"
        else:
            risk = "LOW"

        if days_left is None:
            why = (
                f"No stockout estimate for {row['product']} because daily sales is zero or insufficient dated sales records."
            )
        else:
            why = (
                f"{row['product']} has current_stock={stock}, daily_sales={round(daily_sales, 4)}, "
                f"days_to_stockout={days_left}, trend={trend}."
            )

        target_cover_days = 30
        reorder_qty = 0.0
        
        # Base reorder on daily sales * coverage
        if daily_sales > 0:
            reorder_qty = (daily_sales * target_cover_days)
            
        # Subtract whatever we have. If raw_stock < 0, this adds the shortage!
        reorder_qty -= raw_stock
        
        reorder_qty = max(0.0, round(reorder_qty, 2))

        if "SHORTAGE" in row.get("flags", []):
            what = f"Immediate short-fall detected. Recommended reorder quantity: {reorder_qty} units"
            how = [
                "Fulfill pending backorders immediately",
                "Raise purchase request for shortage + safety stock",
            ]
        elif risk in {"CRITICAL", "HIGH"}:
            what = f"Recommended reorder quantity: {reorder_qty} units"
            how = [
                "Raise purchase request immediately",
                "Validate supplier lead-time and MOQ",
                "Monitor daily consumption until stock stabilizes",
            ]
        elif risk == "MEDIUM":
            what = f"Plan replenishment: {reorder_qty} units within next planning cycle"
            how = [
                "Create planned order in next cycle",
                "Review trend and adjust reorder point",
            ]
        else:
            what = "No urgent reorder needed"
            how = [
                "Continue periodic monitoring",
                "Re-evaluate after next sales period",
            ]

        return {
            "risk_level": risk,
            "WHY": why,
            "WHAT": what,
            "HOW": how,
            "recommended_reorder_quantity": reorder_qty,
            "order_quantity": reorder_qty,  # added alias for UI
        }

    def _calculate_customer_metrics(self) -> None:
        if self.normalized_df.empty:
            self.analysis_results["customer_analysis"] = []
            return

        df = self.normalized_df.copy()
        sale_df = df[df["transaction_type"] == "SALE"].copy()
        if sale_df.empty:
            self.analysis_results["customer_analysis"] = []
            self.analysis_results["data_quality_report"].append("No SALE transactions found for customer analytics")
            return

        sale_df["price"] = pd.to_numeric(sale_df["price"], errors="coerce").fillna(0.0)
        sale_df["amount"] = sale_df["quantity"] * sale_df["price"]

        agg = sale_df.groupby("customer").agg(
            total_purchase=("amount", "sum"),
            frequency=("date", "nunique"),
            total_units=("quantity", "sum"),
            last_purchase_date=("date", "max"),
        ).reset_index()

        monthly = sale_df.copy()
        monthly["period"] = monthly["date"].dt.to_period("M").astype(str)
        weekly = sale_df.copy()
        weekly["week"] = weekly["date"].dt.to_period("W").astype(str)

        contact_lookup = (
            sale_df.groupby("customer", as_index=False)
            .agg(
                customer_email=("customer_email", "first"),
                customer_phone=("customer_phone", "first"),
                customer_address=("customer_address", "first"),
            )
            .fillna({"customer_email": "", "customer_phone": "", "customer_address": ""})
        )
        agg = agg.merge(contact_lookup, on="customer", how="left")

        agg = agg.sort_values("total_purchase", ascending=False).reset_index(drop=True)
        agg["purchase_share"] = agg["total_purchase"] / max(float(agg["total_purchase"].sum()), 1.0)
        agg["cumulative_share"] = agg["purchase_share"].cumsum()
        agg["is_top_customer_80_20"] = agg["cumulative_share"] <= 0.8

        freq_threshold = float(agg["frequency"].median()) if not agg.empty else 0.0
        agg["low_activity"] = agg["frequency"] < max(1.0, freq_threshold)

        # Pre-aggregate monthly and weekly breakdowns to avoid O(N*C) nested loops
        monthly_agg = (
            monthly.groupby(["customer", "period"], as_index=False)
            .agg(quantity=("quantity", "sum"), amount=("amount", "sum"))
            .sort_values("period")
        )
        monthly_map = {}
        for _, m_row in monthly_agg.iterrows():
            cust = m_row["customer"]
            monthly_map.setdefault(cust, []).append({
                "month": m_row["period"],
                "units": round(float(m_row["quantity"]), 4),
                "amount": round(float(m_row["amount"]), 2),
            })

        weekly_agg = (
            weekly.groupby(["customer", "week"], as_index=False)
            .agg(quantity=("quantity", "sum"), amount=("amount", "sum"))
            .sort_values("week")
        )
        weekly_map = {}
        for _, w_row in weekly_agg.iterrows():
            cust = w_row["customer"]
            weekly_map.setdefault(cust, []).append({
                "week": w_row["week"],
                "units": round(float(w_row["quantity"]), 4),
                "amount": round(float(w_row["amount"]), 2),
            })

        self.analysis_results["customer_analysis"] = [
            {
                "customer": row["customer"],
                "email": str(row.get("customer_email") or "").strip() or None,
                "phone": str(row.get("customer_phone") or "").strip() or None,
                "address": str(row.get("customer_address") or "").strip() or None,
                "total_purchase": round(float(row["total_purchase"]), 2),
                "frequency": int(row["frequency"]),
                "total_units": round(float(row["total_units"]), 4),
                "last_purchase_date": (
                    row["last_purchase_date"].date().isoformat()
                    if pd.notna(row.get("last_purchase_date"))
                    else None
                ),
                "is_top_customer_80_20": bool(row["is_top_customer_80_20"]),
                "low_activity": bool(row["low_activity"]),
                "monthly_breakdown": monthly_map.get(row["customer"], []),
                "weekly_breakdown": weekly_map.get(row["customer"], []),
            }
            for _, row in agg.iterrows()
        ]

    def _build_backend_analytics(self) -> None:
        if self.normalized_df.empty:
            self.analysis_results["backend_analytics"] = {
                "monthly": [],
                "trend": "NO_DATA",
                "color_breakdown": {"C": 0.0, "M": 0.0, "Y": 0.0, "K": 0.0, "UNMAPPED": 0.0},
            }
            return

        df = self.normalized_df.copy()
        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        df = df.dropna(subset=["date"])
        if df.empty:
            self.analysis_results["backend_analytics"] = {
                "monthly": [],
                "trend": "UNKNOWN",
                "color_breakdown": {"C": 0.0, "M": 0.0, "Y": 0.0, "K": 0.0, "UNMAPPED": 0.0},
            }
            return

        df["period"] = df["date"].dt.to_period("M").astype(str)
        monthly = (
            df.groupby(["period", "transaction_type"])["quantity"]
            .sum()
            .unstack(fill_value=0.0)
            .reset_index()
        )
        for col in ["PURCHASE", "SALE", "RETURN"]:
            if col not in monthly.columns:
                monthly[col] = 0.0
        monthly = monthly.rename(columns={"PURCHASE": "total_in", "SALE": "total_out", "RETURN": "total_return"})
        monthly = monthly.sort_values("period")

        monthly["net_movement"] = monthly["total_in"] - monthly["total_out"] + monthly["total_return"]
        monthly["growth_pct"] = monthly["total_out"].pct_change().replace([np.inf, -np.inf], np.nan).fillna(0.0) * 100.0

        color_aliases = {
            "C": [" C ", " CYAN "],
            "M": [" M ", " MAGENTA "],
            "Y": [" Y ", " YELLOW "],
            "K": [" K ", " BLACK "],
        }
        sales_df = df[df["transaction_type"] == "SALE"].copy()
        color_breakdown = {"C": 0.0, "M": 0.0, "Y": 0.0, "K": 0.0, "UNMAPPED": 0.0}

        if not sales_df.empty:
            search_text = (sales_df["product"].fillna("") + " " + sales_df["category"].fillna("")).str.upper()
            wrapped_search = " " + search_text + " "
            matched_mask = pd.Series(False, index=sales_df.index)

            for color, aliases in color_aliases.items():
                mask = pd.Series(False, index=sales_df.index)
                for alias in aliases:
                    mask |= wrapped_search.str.contains(alias, regex=False)
                mask |= search_text.str.endswith("-" + color)
                mask |= search_text.str.startswith(color + "-")
                
                assign_mask = mask & ~matched_mask
                color_breakdown[color] = float(sales_df.loc[assign_mask, "quantity"].sum())
                matched_mask |= assign_mask

            color_breakdown["UNMAPPED"] = float(sales_df.loc[~matched_mask, "quantity"].sum())

        self.analysis_results["backend_analytics"] = {
            "monthly": [
                {
                    "month": rec["period"],
                    "total_in": round(float(rec["total_in"]), 4),
                    "total_out": round(float(rec["total_out"]), 4),
                    "total_return": round(float(rec["total_return"]), 4),
                    "net_movement": round(float(rec["net_movement"]), 4),
                    "growth_pct": round(float(rec["growth_pct"]), 2),
                }
                for _, rec in monthly.iterrows()
            ],
            "trend": self._overall_sales_trend(),
            "color_breakdown": {key: round(float(value), 4) for key, value in color_breakdown.items()},
        }

    def _run_consistency_checks(self) -> None:
        checks: List[Dict[str, Any]] = []
        inv = self.analysis_results.get("inventory_summary", {}) or {}
        customer_analysis = self.analysis_results.get("customer_analysis", []) or []
        backend_analytics = self.analysis_results.get("backend_analytics", {}) or {}

        total_in = float(inv.get("total_purchase_units", 0.0)) + float(inv.get("total_opening_stock", 0.0))
        total_out = float(inv.get("total_sales_units", 0.0))
        total_return = float(inv.get("total_return_units", 0.0))
        current_stock = float(inv.get("total_current_stock", 0.0))
        expected_stock = total_in - total_out + total_return
        adjusted_expected_stock = expected_stock + float(inv.get("negative_stock_units_adjusted", 0.0))
        checks.append(
            {
                "name": "inventory_balance",
                "passed": bool(round(adjusted_expected_stock, 4) == round(current_stock, 4)),
                "expected": round(adjusted_expected_stock, 4),
                "actual": round(current_stock, 4),
            }
        )

        monthly = backend_analytics.get("monthly", []) if isinstance(backend_analytics, dict) else []
        analytics_out_total = sum(float(rec.get("total_out", 0.0)) for rec in monthly)
        checks.append(
            {
                "name": "analytics_vs_transactions",
                "passed": bool(round(analytics_out_total, 4) == round(total_out, 4)),
                "expected": round(total_out, 4),
                "actual": round(analytics_out_total, 4),
            }
        )

        customer_total_units = sum(float(rec.get("total_units", 0.0)) for rec in customer_analysis)
        checks.append(
            {
                "name": "customers_vs_transactions",
                "passed": bool(round(customer_total_units, 4) == round(total_out, 4)),
                "expected": round(total_out, 4),
                "actual": round(customer_total_units, 4),
            }
        )

        inventory_by_location = self.analysis_results.get("inventory_by_location", []) or []
        location_stock_sum = sum(float(rec.get("current_stock", 0.0)) for rec in inventory_by_location)
        checks.append(
            {
                "name": "inventory_vs_location_totals",
                "passed": bool(round(location_stock_sum, 4) == round(current_stock, 4)),
                "expected": round(current_stock, 4),
                "actual": round(location_stock_sum, 4),
            }
        )

        self.validation_counters["inconsistencies"] = int(sum(1 for check in checks if not check.get("passed")))
        if self.validation_counters["inconsistencies"] > 0:
            self.analysis_results["data_quality_report"].append(
                f"Consistency checks failed: {self.validation_counters['inconsistencies']}"
            )

        self.analysis_results["consistency_checks"] = checks

    def _generate_alerts(self) -> None:
        alerts: List[Dict[str, Any]] = []

        for p in self.analysis_results.get("products_analysis", []):
            if p["risk_level"] in {"CRITICAL", "HIGH"}:
                alerts.append(
                    {
                        "severity": "HIGH" if p["risk_level"] == "HIGH" else "CRITICAL",
                        "type": "STOCK_RISK",
                        "product": p["product"],
                        "message": p["WHY"],
                    }
                )
            if "SHORTAGE" in p.get("flags", []):
                alerts.append(
                    {
                        "severity": "CRITICAL",
                        "type": "SHORTAGE",
                        "product": p["product"],
                        "message": "Unfulfilled order shortage; stock demand exists without available inventory",
                    }
                )
            if p.get("movement_class") == "DEAD_STOCK":
                alerts.append(
                    {
                        "severity": "MEDIUM",
                        "type": "DEAD_STOCK",
                        "product": p["product"],
                        "message": "No sales movement detected for this product",
                    }
                )

        if self.validation_counters["unknown_type_rows"] > 0:
            alerts.append(
                {
                    "severity": "HIGH",
                    "type": "DATA_QUALITY",
                    "product": None,
                    "message": f"{self.validation_counters['unknown_type_rows']} transactions could not be typed",
                }
            )

        self.analysis_results["alerts"] = alerts

    def _validate_and_score_confidence(self) -> None:
        total_rows = max(1, self.validation_counters["total_transaction_rows"])

        unknown_ratio = self.validation_counters["unknown_type_rows"] / total_rows
        invalid_ratio = self.validation_counters["invalid_rows_skipped"] / total_rows
        product_miss_ratio = self.validation_counters["product_join_miss"] / max(1, self.validation_counters["normalized_rows"])

        penalty = 0.0
        penalty += unknown_ratio * 35
        penalty += invalid_ratio * 35
        penalty += product_miss_ratio * 15
        penalty += min(self.validation_counters["missing_mappings"] * 4, 20)
        if self.normalized_df.empty:
            penalty += 60

        score = max(0.0, min(100.0, self.base_confidence - penalty))
        score = round(float(score), 2)

        if score < 60:
            self.analysis_results["data_quality_report"].append(
                "Confidence below 60. AI decisions are blocked due to data quality risk."
            )
            for product in self.analysis_results.get("products_analysis", []):
                product["WHAT"] = "AI decision blocked due to low confidence score"
                product["HOW"] = [
                    "Fix column mappings and transaction types",
                    "Reprocess data after validation",
                ]

        elif score <= 80:
            self.analysis_results["data_quality_report"].append(
                "Confidence between 60 and 80. Use recommendations with caution."
            )
        else:
            self.analysis_results["data_quality_report"].append(
                "Confidence above 80. Recommendations are safe for operational review."
            )

        for warning in self.global_warnings:
            self.analysis_results["data_quality_report"].append(f"Warning: {warning}")

        self.analysis_results["confidence_score"] = score
        if score >= 80:
            self.analysis_results["confidence_label"] = "HIGH"
        elif score >= 60:
            self.analysis_results["confidence_label"] = "MEDIUM"
        else:
            self.analysis_results["confidence_label"] = "LOW"

    def _first_non_null(self, group: pd.DataFrame, column: str, default: Any = np.nan) -> Any:
        if column not in group.columns:
            return default
        values = group[column].dropna()
        if values.empty:
            return default
        return values.iloc[0]

    def _coalesce_numeric(self, *values: Any, fallback: float = 0.0) -> float:
        for value in values:
            try:
                if pd.notna(value):
                    return float(value)
            except Exception:
                continue
        return float(fallback)


def process_excel(file_path: str) -> Dict[str, Any]:
    """
    Main pipeline entrypoint.

    Returns:
    {
      "products_analysis": [...],
      "customer_analysis": [...],
      "inventory_summary": {...},
      "alerts": [...],
      "data_quality_report": [...],
      "confidence_score": number
    }
    """
    from ingestion.excel_processor import ExcelProcessor

    processor = ExcelProcessor(file_path)
    processor.load_and_classify()
    bundle = processor.get_bundle()

    core = COOCore(bundle)
    return core.process()
