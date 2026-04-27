import pandas as pd
import numpy as np


def _parse_mixed_dates(series: pd.Series) -> pd.Series:
    """Parse mixed date formats robustly without misreading ISO yyyy-mm-dd values."""
    raw = series.astype(str).str.strip()
    parsed = pd.to_datetime(raw, errors='coerce', dayfirst=False)
    missing_mask = parsed.isna()
    if missing_mask.any():
        parsed.loc[missing_mask] = pd.to_datetime(raw[missing_mask], errors='coerce', dayfirst=True)
    return parsed

def compute_inventory_metrics(df: pd.DataFrame) -> list:
    """
    Computes accurate inventory metrics strictly adhering to real business logic
    from transaction-level data.
    
    Expected Columns:
    - DATE
    - PRODUCT
    - PARTY NAME
    - IN/OUT
    - QUANTITY
    - CHECK QUANTITY
    """
    if df is None or df.empty:
        return []

    df = df.copy()

    # Standardize column casing for robustness and avoid trailing spaces
    df.columns = df.columns.str.strip().str.upper()
    # Guard against duplicate logical headers after normalization (e.g. "Party Name" and "PARTY NAME ")
    if df.columns.duplicated().any():
        df = df.loc[:, ~df.columns.duplicated()].copy()
    
    # Map any aliased columns if needed (e.g. PARTY NAME to PARTY_NAME)
    col_mapping = {
        'CHECK': 'CHECK QUANTITY',
        'PARTY': 'PARTY NAME'
    }
    for col in df.columns:
        for k, v in col_mapping.items():
            if k in col and v not in df.columns:
                df.rename(columns={col: v}, inplace=True)

    required_cols = {"DATE", "PRODUCT", "PARTY NAME", "IN/OUT", "QUANTITY", "CHECK QUANTITY"}
    missing = required_cols - set(df.columns)
    if missing:
        raise ValueError(f"Missing required columns for inventory metrics: {missing}")

    # Normalize textual dimensions used in groupby keys.
    df['PRODUCT'] = df['PRODUCT'].astype(str).str.strip()
    df['PARTY NAME'] = df['PARTY NAME'].astype(str).str.strip()
    df['IN/OUT'] = df['IN/OUT'].astype(str).str.strip().str.upper()

    # Ensure quantity columns are numeric
    df['QUANTITY'] = pd.to_numeric(df['QUANTITY'], errors='coerce').fillna(0)
    df['CHECK QUANTITY'] = pd.to_numeric(df['CHECK QUANTITY'], errors='coerce').fillna(0)
    df['_date_parsed'] = _parse_mixed_dates(df['DATE'])
    
    # --------------------------------------------------
    # 1. DEMAND CALCULATION (NO DOUBLE COUNTING)
    # --------------------------------------------------
    # ALWAYS use ABS(quantity) for demand and exclude invalid/zero quantities.
    df['ABS_QTY'] = df['QUANTITY'].abs()

    # Party-level cancel semantics:
    # If latest transaction for a (PRODUCT, PARTY NAME) has QUANTITY == 0,
    # treat that party as currently not requiring stock (cancel/no active order).
    party_state_df = df[(df['PRODUCT'] != '') & (df['PARTY NAME'] != '')].copy()
    party_state_df['_row_order'] = np.arange(len(party_state_df))
    party_state_df = party_state_df.sort_values(
        by=['_date_parsed', '_row_order'],
        ascending=[True, True],
        na_position='first',
    )
    latest_party_rows = party_state_df.groupby(['PRODUCT', 'PARTY NAME'], as_index=False).tail(1)
    cancelled_pairs = latest_party_rows[latest_party_rows['QUANTITY'] == 0][['PRODUCT', 'PARTY NAME']].copy()
    if not cancelled_pairs.empty:
        cancelled_pairs['is_cancelled_pair'] = True

    valid_demand_df = df[
        (df['PRODUCT'] != '')
        & (df['PARTY NAME'] != '')
        & (df['IN/OUT'].isin(['IN', 'OUT']))
        & (df['ABS_QTY'] > 0)
    ].copy()

    if not cancelled_pairs.empty:
        valid_demand_df = valid_demand_df.merge(
            cancelled_pairs,
            on=['PRODUCT', 'PARTY NAME'],
            how='left',
        )
        valid_demand_df = valid_demand_df[valid_demand_df['is_cancelled_pair'] != True].drop(columns=['is_cancelled_pair'])

    # Group by PRODUCT, PARTY NAME, IN/OUT then aggregate once to avoid duplication.
    grouped = valid_demand_df.groupby(['PRODUCT', 'PARTY NAME', 'IN/OUT'], as_index=False)['ABS_QTY'].sum()
    
    # Pivot to separate IN and OUT
    pivot_df = grouped.pivot_table(
        index=['PRODUCT', 'PARTY NAME'],
        columns='IN/OUT',
        values='ABS_QTY',
        aggfunc='sum',
        fill_value=0
    ).reset_index()
    
    # Ensure columns exist
    if 'IN' not in pivot_df.columns:
        pivot_df['IN'] = 0.0
    if 'OUT' not in pivot_df.columns:
        pivot_df['OUT'] = 0.0
        
    # Apply logic: IF both IN and OUT exist -> MAX(total_in, total_out)
    # ELSE -> whichever exists 
    # (Since we fill missing with 0, a simple max() naturally achieves this)
    pivot_df['demand'] = pivot_df[['IN', 'OUT']].max(axis=1)
    
    # Final Total Demand (sum of group-level demand).
    total_demand = pivot_df.groupby('PRODUCT', as_index=False)['demand'].sum()
    total_demand.rename(columns={'demand': 'total_demand'}, inplace=True)
    
    # --------------------------------------------------
    # 2. ON HAND STOCK (LATEST STATE ONLY)
    # --------------------------------------------------
    stock_df = df[df['PRODUCT'] != ''].copy()

    # Sort by parsed date (ascending).
    # For same-date rows, prefer higher SR NO if available; then use row order.
    stock_df['_row_order'] = np.arange(len(stock_df))
    sr_no_col = 'SR NO' if 'SR NO' in stock_df.columns else None
    if sr_no_col:
        stock_df['_sr_no_num'] = pd.to_numeric(stock_df[sr_no_col], errors='coerce')
    else:
        stock_df['_sr_no_num'] = np.nan

    stock_df = stock_df.sort_values(
        by=['_date_parsed', '_sr_no_num', '_row_order'],
        ascending=[True, True, True],
        na_position='first'
    )
    
    # Get ONLY the latest (last) row per product
    latest_rows = stock_df.groupby('PRODUCT', as_index=False).tail(1).copy()
    
    # On-hand is based strictly on latest CHECK QUANTITY value.
    latest_rows['on_hand'] = latest_rows['CHECK QUANTITY'].abs()
    
    on_hand_stock = latest_rows[['PRODUCT', 'on_hand']]
    
    # --------------------------------------------------
    # 3. FINAL METRICS
    # --------------------------------------------------
    # Merge demand and on-hand
    final_metrics = pd.merge(total_demand, on_hand_stock, on='PRODUCT', how='outer').fillna(0)

    # Enforce non-negative metrics before final projection.
    final_metrics['total_demand'] = final_metrics['total_demand'].clip(lower=0)
    final_metrics['on_hand'] = final_metrics['on_hand'].clip(lower=0)
    
    # Rules: stock_required = total_demand - on_hand
    # stock_required cannot be negative → use max(0, value)
    final_metrics['stock_required'] = np.maximum(0, final_metrics['total_demand'] - final_metrics['on_hand'])
    
    # --------------------------------------------------
    # 5. FRONTEND REQUIREMENTS
    # --------------------------------------------------
    for col in ['total_demand', 'on_hand', 'stock_required']:
        final_metrics[col] = final_metrics[col].astype(float).round(2)
        final_metrics[col] = final_metrics[col].apply(lambda x: 0.0 if not np.isfinite(x) or np.isclose(x, 0) else x)
    
    # --------------------------------------------------
    # 8. OUTPUT FORMAT (STRICT)
    # --------------------------------------------------
    final_metrics.rename(columns={'PRODUCT': 'product'}, inplace=True)
    records = final_metrics[['product', 'total_demand', 'on_hand', 'stock_required']].to_dict('records')
    
    return records


def _compute_confidence_label(score: float) -> str:
    if score >= 85:
        return "HIGH"
    if score >= 65:
        return "MEDIUM"
    return "LOW"


def _build_strict_sales_series(df: pd.DataFrame) -> tuple[list, dict]:
    if df is None or df.empty:
        return [], {
            "total_rows": 0,
            "valid_date_rows": 0,
            "valid_out_rows": 0,
            "valid_out_qty_rows": 0,
            "clean_daily_points": 0,
            "date_coverage_ratio": 0.0,
            "sales_signal_ratio": 0.0,
            "quality_score": 0.0,
        }

    working = df.copy()
    working.columns = working.columns.str.strip().str.upper()
    if working.columns.duplicated().any():
        working = working.loc[:, ~working.columns.duplicated()].copy()

    date_col = "DATE" if "DATE" in working.columns else None
    qty_col = "QUANTITY" if "QUANTITY" in working.columns else None
    io_col = "IN/OUT" if "IN/OUT" in working.columns else None

    if not date_col or not qty_col:
        return [], {
            "total_rows": int(len(working)),
            "valid_date_rows": 0,
            "valid_out_rows": 0,
            "valid_out_qty_rows": 0,
            "clean_daily_points": 0,
            "date_coverage_ratio": 0.0,
            "sales_signal_ratio": 0.0,
            "quality_score": 0.0,
        }

    working["_date_parsed"] = _parse_mixed_dates(working[date_col])
    working["_qty"] = pd.to_numeric(working[qty_col], errors='coerce')
    if io_col:
        io = working[io_col].astype(str).str.strip().str.upper()
    else:
        io = pd.Series(["OUT"] * len(working), index=working.index)
    working["_io"] = io

    valid_date_mask = working["_date_parsed"].notna()
    out_mask = working["_io"].isin(["OUT", "SALE", "DELIVERY", "DISPATCH", "INVOICE"])
    positive_qty_mask = working["_qty"].notna() & (working["_qty"].abs() > 0)

    clean = working[valid_date_mask & out_mask & positive_qty_mask].copy()
    if clean.empty:
        quality = {
            "total_rows": int(len(working)),
            "valid_date_rows": int(valid_date_mask.sum()),
            "valid_out_rows": int((valid_date_mask & out_mask).sum()),
            "valid_out_qty_rows": 0,
            "clean_daily_points": 0,
            "date_coverage_ratio": round(float(valid_date_mask.mean()), 4) if len(working) else 0.0,
            "sales_signal_ratio": 0.0,
            "quality_score": 0.0,
        }
        return [], quality

    clean["_qty_abs"] = clean["_qty"].abs()
    daily = (
        clean.groupby(clean["_date_parsed"].dt.date)["_qty_abs"]
        .sum()
        .sort_index()
    )

    past_sales_daily = [
        {"date": str(day), "actual": round(float(value), 2)}
        for day, value in daily.items()
    ]

    coverage = float(valid_date_mask.mean()) if len(working) else 0.0
    signal_ratio = float((valid_date_mask & out_mask & positive_qty_mask).mean()) if len(working) else 0.0
    points_score = min(1.0, len(past_sales_daily) / 365.0)
    quality_score = round((coverage * 0.35 + signal_ratio * 0.45 + points_score * 0.20) * 100, 2)

    quality = {
        "total_rows": int(len(working)),
        "valid_date_rows": int(valid_date_mask.sum()),
        "valid_out_rows": int((valid_date_mask & out_mask).sum()),
        "valid_out_qty_rows": int((valid_date_mask & out_mask & positive_qty_mask).sum()),
        "clean_daily_points": int(len(past_sales_daily)),
        "date_coverage_ratio": round(coverage, 4),
        "sales_signal_ratio": round(signal_ratio, 4),
        "quality_score": quality_score,
    }
    return past_sales_daily, quality


def _build_weekly_sales(past_sales_daily: list) -> list:
    if not past_sales_daily:
        return []
    df = pd.DataFrame(past_sales_daily)
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df["actual"] = pd.to_numeric(df["actual"], errors="coerce").fillna(0.0)
    df = df.dropna(subset=["date"])
    if df.empty:
        return []

    weekly = (
        df.set_index("date")["actual"]
        .resample("W-MON")
        .sum()
        .sort_index()
    )
    return [
        {"date": d.strftime("%Y-%m-%d"), "actual": round(float(v), 2)}
        for d, v in weekly.items()
    ]


def _build_forecast_from_past_sales(past_sales_daily: list, horizon_days: int = 90) -> tuple[list, list]:
    if not past_sales_daily:
        return [], []

    df = pd.DataFrame(past_sales_daily)
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df["actual"] = pd.to_numeric(df["actual"], errors="coerce").fillna(0.0)
    df = df.dropna(subset=["date"]).sort_values("date")
    if df.empty:
        return [], []

    recent_window = df.tail(min(len(df), 56)).copy()
    baseline = float(recent_window["actual"].mean()) if not recent_window.empty else 0.0
    baseline = max(0.0, baseline)

    # Deterministic weekday seasonality learned from recent clean rows.
    weekday_avg = recent_window.groupby(recent_window["date"].dt.weekday)["actual"].mean().to_dict()
    overall = max(1.0, baseline)
    weekday_factor = {
        wd: float(np.clip((weekday_avg.get(wd, overall) / overall), 0.75, 1.25))
        for wd in range(7)
    }

    last_day = df["date"].iloc[-1].to_pydatetime()
    demand_forecast = []
    next_365_days = []

    for i in range(1, 366):
        target_date = last_day + pd.Timedelta(days=i)
        factor = weekday_factor.get(target_date.weekday(), 1.0)
        predicted = max(0.0, baseline * factor)
        lower = max(0.0, predicted * 0.9)
        upper = max(0.0, predicted * 1.1)
        next_365_days.append(round(float(predicted), 2))
        if i <= horizon_days:
            demand_forecast.append({
                "date": target_date.strftime("%Y-%m-%d"),
                "predicted": round(float(predicted), 2),
                "predicted_demand": round(float(predicted), 2),
                "lower": round(float(lower), 2),
                "lower_bound": round(float(lower), 2),
                "upper": round(float(upper), 2),
                "upper_bound": round(float(upper), 2),
                "production": round(float(predicted * 1.12), 2),
            })

    return demand_forecast, next_365_days


def _derive_sales_summary(past_sales_daily: list) -> dict:
    if not past_sales_daily:
        return {"total_sales": 0.0, "trend": "Insufficient data"}

    vals = [float(row.get("actual", 0) or 0) for row in past_sales_daily]
    total_sales = round(float(sum(vals)), 2)
    if len(vals) < 14:
        return {"total_sales": total_sales, "trend": "Insufficient data"}

    recent = np.mean(vals[-30:]) if len(vals) >= 30 else np.mean(vals[-7:])
    prev = np.mean(vals[-60:-30]) if len(vals) >= 60 else np.mean(vals[:-7] or [0])
    if prev <= 0:
        trend = "Stable"
    else:
        delta = (recent - prev) / prev
        if delta > 0.08:
            trend = "Uptrend"
        elif delta < -0.08:
            trend = "Downtrend"
        else:
            trend = "Stable"
    return {"total_sales": total_sales, "trend": trend}


def generate_full_analysis_payload(df: pd.DataFrame) -> dict:
    """
    Wraps compute_inventory_metrics into the standard 'analysis_package' JSON format
    consumed by AIRealTimeProcessor.jsx and InventoryRisks.jsx.
    """
    metrics = compute_inventory_metrics(df)
    past_sales_daily, quality = _build_strict_sales_series(df)
    past_sales_weekly = _build_weekly_sales(past_sales_daily)
    demand_forecast, next_365_days = _build_forecast_from_past_sales(past_sales_daily, horizon_days=90)
    sales_summary = _derive_sales_summary(past_sales_daily)

    confidence_score = quality.get("quality_score", 0.0)
    confidence_label = _compute_confidence_label(confidence_score)
    has_forecast_signal = bool(past_sales_daily and demand_forecast)
    
    products_analysis = []
    out_of_stock = 0
    overstock = 0
    healthy = 0
    low_stock = 0
    deadstock = 0
    
    for idx, item in enumerate(metrics):
        risk = "HEALTHY"
        status_label = "HEALTHY"
        
        on_hand = item['on_hand']
        demand = item['total_demand']
        stock_req = item['stock_required']
        
        # Risk Logic strictly based on stock vs demand
        if on_hand <= 0 and demand > 0:
            risk = "OUT_OF_STOCK"
            status_label = "OUT_OF_STOCK"
            out_of_stock += 1
        elif on_hand <= 0 and demand <= 0:
            risk = "DEADSTOCK"
            status_label = "DEADSTOCK"
            deadstock += 1
        elif stock_req > 0:
            risk = "LOW_STOCK"
            status_label = "LOW_STOCK"
            low_stock += 1
        else:
            if on_hand > (demand * 3) and demand > 0: # Arbitrary overstock logic
                risk = "OVERSTOCK"
                status_label = "OVERSTOCK"
                overstock += 1
            else:
                risk = "HEALTHY"
                status_label = "HEALTHY"
                healthy += 1
                
        # Remap into backend struct
        products_analysis.append({
            "id": idx + 1,
            "sku": f"PRD-{idx:04d}",
            "name": item['product'],
            "product_name": item['product'],
            "on_hand": on_hand,
            "current_stock": on_hand,
            "daily_demand": demand,   # UI explicitly checks this or avg_sales
            "avg_sales": demand,
            "order_quantity": stock_req,
            "recommended_reorder_quantity": stock_req,
            "risk": risk,
            "status": status_label,
            "health_status": status_label,
            "confidence_score": round(float(confidence_score), 2),
        })

    recommendations = []
    if not has_forecast_signal:
        recommendations.append("No reliable clean OUT sales timeline found. Upload complete dated sales transactions for forecasting.")
    if quality.get("date_coverage_ratio", 0) < 0.9:
        recommendations.append("Date coverage is below 90%. Fix invalid/missing dates to improve forecast accuracy.")
    if quality.get("sales_signal_ratio", 0) < 0.7:
        recommendations.append("Many rows are not valid sales signal rows. Ensure IN/OUT and QUANTITY values are consistent.")

    if not recommendations:
        recommendations.append("Clean sales signal quality looks stable. Forecast uses strict date + quantity ledger rows only.")

    return {
        "analysis_isolation": {
            "analysis_mode": "DETERMINISTIC_RULES",
            "confidence": confidence_label
        },
        "confidence_score": round(float(confidence_score), 2),
        "confidence_label": confidence_label,
        "summary": {
            "overview": "Data processed with strict ledger inventory rules preventing double counting.",
            "total_products": len(products_analysis),
            "out_of_stock": out_of_stock,
            "low_stock": low_stock,
            "deadstock": deadstock,
            "overstock": overstock,
            "healthy": healthy,
        },
        "stock_analysis": {
            "out_of_stock_items": out_of_stock,
            "low_stock_items": low_stock,
            "deadstock_items": deadstock,
            "overstock_items": overstock,
            "healthy_items": healthy,
        },
        "sales_summary": sales_summary,
        "past_sales_daily": past_sales_daily,
        "past_sales_weekly": past_sales_weekly,
        "past_sales": past_sales_daily,
        "demand_forecast": demand_forecast,
        "demand_forecast_is_synthetic": not has_forecast_signal,
        "demand_forecast_source": "strict_clean_sales" if has_forecast_signal else "insufficient_clean_signal",
        "forecast": {
            "next_365_days": next_365_days,
        },
        "metadata": {
            "analysis_mode": "DETERMINISTIC_RULES",
            "confidence": confidence_label,
            "forecast_quality": quality,
            "forecast_signal_ready": has_forecast_signal,
            "warnings": [] if has_forecast_signal else ["Forecast signal quality is low due to insufficient clean sales rows."],
        },
        "recommendations": recommendations,
        "products_analysis": products_analysis,
        # Maintain legacy keys just in case
        "products": products_analysis,
    }
