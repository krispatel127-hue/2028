import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '../api/client';
import {
  buildInventoryFromTransactions,
  extractInventoryRows,
  DEFAULT_LOW_STOCK_THRESHOLD,
} from '../features/inventory-engine/buildInventoryFromTransactions';
import { AnalysisContext } from './analysisContextCore';

const LAST_ANALYSIS_STORAGE_KEY = 'ai-ops-last-analysis-snapshot';
const ANALYSIS_POLL_TIMEOUT_MS = 7000;

const toNum = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const LOW_STOCK_FALLBACK_THRESHOLD = DEFAULT_LOW_STOCK_THRESHOLD;
const ANALYSIS_FINGERPRINT_MAX_LENGTH = 200000;

const deriveConfidenceLabel = (score) => {
  const s = toNum(score, 0);
  if (s >= 80) return 'HIGH';
  if (s >= 60) return 'MEDIUM';
  return 'LOW';
};

const isNameLike = (value) => {
  const text = String(value || '').trim();
  if (!text) return false;
  if (/^\d+$/.test(text)) return false;
  if (/^party\s*[-#:]*\s*\d+$/i.test(text)) return false;
  return true;
};

const pickPreferredCustomerName = (customer = {}) => {
  const candidates = [
    customer.party_name,
    customer.party,
    customer.customer_name,
    customer.name,
    customer.company,
    customer.account_name,
    customer.buyer_name,
    customer.buyer,
    customer.customer,
    customer.sold_to_name,
  ];

  const preferred = candidates.find(isNameLike);
  if (preferred) return preferred;
  return candidates.find((value) => String(value || '').trim()) || null;
};

const buildCustomersFromCustomerAnalysis = (customerAnalysis = []) => {
  return customerAnalysis.map((c, idx) => {
    const freq = toNum(c.frequency, 0);
    let intensityLevel = 'HEALTHY';
    let intensityLabel = 'ACTIVE';
    let risk = 'ACTIVE';
    if (freq <= 0 || c.low_activity) {
      intensityLevel = 'LIYA_HI_NAHI';
      intensityLabel = 'NO PURCHASE';
      risk = 'CHURN_RISK';
    } else if (freq <= 1) {
      intensityLevel = 'BAHUT_KAM';
      intensityLabel = 'VERY LOW';
      risk = 'CHURN_RISK';
    } else if (freq <= 2) {
      intensityLevel = 'THODA_KAM';
      intensityLabel = 'LOW';
      risk = 'WATCH';
    }

    const monthlyTrend = risk === 'CHURN_RISK' ? 'down' : (risk === 'WATCH' ? 'flat' : 'up');

    const resolvedName = pickPreferredCustomerName(c) || c.customer;

    return {
      id: idx + 1,
      name: resolvedName,
      customer_name: resolvedName,
      customer_id: c.customer_id || c.party_id || c.party_code || c.customer || `CUST-${idx + 1}`,
      company: resolvedName,
      total_purchase: toNum(c.total_purchase, 0),
      frequency: freq,
      intensity_level: intensityLevel,
      intensity_label: intensityLabel,
      risk,
      reason: c.low_activity ? 'Low purchase activity based on frequency analysis' : 'Active account',
      email: null,
      phone: null,
      address: null,
      last_order_date: c.last_order_date || c.last_purchase_date || null,
      last_purchase_date: c.last_purchase_date || c.last_order_date || null,
      monthly_trend: c.monthly_trend || monthlyTrend,
    };
  });
};

const buildCustomersFromProductsFallback = (products = []) => {
  const byCustomer = new Map();

  products.forEach((p) => {
    const topCustomers = Array.isArray(p?.top_customers) ? p.top_customers : [];
    topCustomers.forEach((c) => {
      const key = String(c?.customer_id || c?.name || c?.company || '').trim();
      if (!key) return;

      const totalPurchased = toNum(c?.total_purchased ?? c?.total_purchase, 0);
      const frequency = toNum(c?.frequency, 0);
      const trendTag = String(c?.trend_tag || '').toUpperCase();
      const riskTag = String(c?.risk_level || '').toUpperCase();

      let intensityLevel = 'HEALTHY';
      let intensityLabel = 'ACTIVE';
      let risk = 'ACTIVE';

      if (riskTag.includes('HIGH') || trendTag.includes('DROP')) {
        intensityLevel = 'BAHUT_KAM';
        intensityLabel = 'VERY LOW';
        risk = 'CHURN_RISK';
      } else if (riskTag.includes('MEDIUM') || trendTag.includes('MIXED')) {
        intensityLevel = 'THODA_KAM';
        intensityLabel = 'LOW';
        risk = 'WATCH';
      }

      const monthlyTrend = trendTag.includes('UP')
        ? 'up'
        : (trendTag.includes('DROP') || risk === 'CHURN_RISK' ? 'down' : (risk === 'WATCH' ? 'flat' : 'up'));

      const current = byCustomer.get(key);
      if (!current || totalPurchased > toNum(current.total_purchase, 0)) {
        byCustomer.set(key, {
          id: byCustomer.size + 1,
          name: c?.name || key,
          customer_name: c?.name || key,
          customer_id: c?.customer_id || key,
          company: c?.company || c?.name || key,
          total_purchase: totalPurchased,
          frequency,
          intensity_level: intensityLevel,
          intensity_label: intensityLabel,
          risk,
          reason: c?.trend_tag || (risk === 'CHURN_RISK' ? 'Low purchase activity detected' : 'Customer is active'),
          email: c?.email || null,
          phone: c?.phone || null,
          address: c?.address || null,
          last_order_date: c?.last_order || c?.last_order_date || null,
          last_purchase_date: c?.last_order_date || c?.last_order || null,
          monthly_trend: monthlyTrend,
        });
      }
    });
  });

  return Array.from(byCustomer.values());
};

const normalizeIncomingCustomer = (customer = {}, idx = 0) => {
  const riskRaw = String(customer.risk || customer.risk_level || customer.status || '').toUpperCase();
  const levelRaw = String(customer.intensity_level || '').toUpperCase();
  const trendRaw = String(customer.monthly_trend || '').toLowerCase();
  const frequency = toNum(customer.frequency, 0);

  let intensityLevel = levelRaw;
  let intensityLabel = String(customer.intensity_label || '').toUpperCase();
  let risk = String(customer.risk || '').toUpperCase();

  if (!['LIYA_HI_NAHI', 'BAHUT_KAM', 'THODA_KAM', 'HEALTHY'].includes(intensityLevel)) {
    if (
      trendRaw === 'down'
      || riskRaw.includes('STOPPED')
      || riskRaw.includes('CHURN')
      || riskRaw.includes('NOT_PURCHASED')
      || riskRaw.includes('NO_PURCHASE')
      || frequency <= 0
    ) {
      intensityLevel = 'LIYA_HI_NAHI';
    } else if (riskRaw.includes('VERY_LOW') || riskRaw.includes('HIGH_RISK')) {
      intensityLevel = 'BAHUT_KAM';
    } else if (trendRaw === 'flat' || riskRaw.includes('BUYING_LESS') || riskRaw.includes('WATCH') || riskRaw.includes('LOW')) {
      intensityLevel = 'THODA_KAM';
    } else {
      intensityLevel = 'HEALTHY';
    }
  }

  if (!intensityLabel) {
    intensityLabel = intensityLevel === 'LIYA_HI_NAHI'
      ? 'NO PURCHASE'
      : intensityLevel === 'BAHUT_KAM'
        ? 'VERY LOW'
        : intensityLevel === 'THODA_KAM'
          ? 'LOW'
          : 'ACTIVE';
  }

  if (!risk) {
    risk = intensityLevel === 'LIYA_HI_NAHI' || intensityLevel === 'BAHUT_KAM'
      ? 'CHURN_RISK'
      : intensityLevel === 'THODA_KAM'
        ? 'WATCH'
        : 'ACTIVE';
  }

  const monthlyTrend = trendRaw === 'up' || trendRaw === 'down' || trendRaw === 'flat'
    ? trendRaw
    : (risk === 'CHURN_RISK' ? 'down' : (risk === 'WATCH' ? 'flat' : 'up'));

  const resolvedName = pickPreferredCustomerName(customer);
  const resolvedId = customer.customer_id || customer.party_id || customer.party_code || customer.account_id || customer.customer_code || customer.customerid || customer.partycode;

  return {
    ...customer,
    id: customer.id ?? idx + 1,
    name: resolvedName || customer.name || customer.customer_name || customer.company || customer.customer_id || `Customer-${idx + 1}`,
    customer_name: resolvedName || customer.customer_name || customer.name || customer.company || customer.customer_id || `Customer-${idx + 1}`,
    customer_id: resolvedId || customer.customer_id || customer.customer_name || customer.name || `CUST-${idx + 1}`,
    company: customer.company || resolvedName || customer.customer_name || customer.name || 'Individual',
    total_purchase: toNum(customer.total_purchase ?? customer.total_purchased, 0),
    frequency,
    intensity_level: intensityLevel,
    intensity_label: intensityLabel,
    risk,
    reason: customer.reason || customer.insight || (risk === 'CHURN_RISK' ? 'Low purchase activity detected' : 'Customer is active'),
    email: customer.email || null,
    phone: customer.phone || null,
    address: customer.address || null,
    last_order_date: customer.last_order_date || customer.last_purchase_date || customer.last_order || null,
    last_purchase_date: customer.last_purchase_date || customer.last_order_date || customer.last_order || null,
    monthly_trend: monthlyTrend,
  };
};

const normalizeAnalysisPayload = (payload) => {
  if (!payload || typeof payload !== 'object') return payload;

  const productsAnalysis = Array.isArray(payload.products_analysis) ? payload.products_analysis : [];
  const inventoryRows = extractInventoryRows(payload);
  const inventoryModel = buildInventoryFromTransactions(inventoryRows, {
    lowStockThreshold: LOW_STOCK_FALLBACK_THRESHOLD,
  });
  const products = inventoryModel.products;

  const customerAnalysis = Array.isArray(payload.customer_analysis) ? payload.customer_analysis : [];
  const customerFallback = buildCustomersFromProductsFallback(products);
  const incomingCustomers = Array.isArray(payload.customers) ? payload.customers.map((c, idx) => normalizeIncomingCustomer(c, idx)) : [];
  const customers = incomingCustomers.length
    ? incomingCustomers
    : (customerAnalysis.length ? buildCustomersFromCustomerAnalysis(customerAnalysis) : customerFallback);

  const hasAnyRiskKeys = (obj = {}, keys = []) => keys.some((key) => Object.prototype.hasOwnProperty.call(obj, key));
  const toNumSafe = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };
  const hasSignal = (obj = {}, keys = []) => keys.reduce((sum, key) => sum + toNumSafe(obj?.[key]), 0) > 0;

  const payloadStockAnalysis = payload.stock_analysis && typeof payload.stock_analysis === 'object'
    ? payload.stock_analysis
    : null;
  const payloadSummary = payload.summary && typeof payload.summary === 'object'
    ? payload.summary
    : null;

  const stockAnalysis = (payloadStockAnalysis && hasAnyRiskKeys(payloadStockAnalysis, [
    'out_of_stock_items', 'low_stock_items', 'deadstock_items', 'overstock_items', 'healthy_items',
  ]))
    ? payloadStockAnalysis
    : inventoryModel.stock_analysis;

  const inventorySummary = {
    ...(payload.inventory_summary || {}),
    ...inventoryModel.inventory_summary,
  };

  if (inventorySummary.total_sales == null) {
    inventorySummary.total_sales = inventorySummary.total_sales_units ?? products.reduce((s, p) => s + toNum(p.total_sales, 0), 0);
  }
  if (inventorySummary.total_revenue == null) {
    inventorySummary.total_revenue = products.reduce(
      (s, p) => s + (toNum(p.total_sales, 0) * toNum(p.unit_price ?? p.price ?? 0, 0)),
      0
    );
  }

  const hasNativeDemandForecast = Array.isArray(payload.demand_forecast) && payload.demand_forecast.length > 0;
  const backendExplicitNoSignal = (
    payload?.metadata?.forecast_signal_ready === false
    || payload?.demand_forecast_source === 'insufficient_clean_signal'
  );
  // Strict mode: never auto-generate demand forecast. Use backend analysis only.
  const demandForecast = hasNativeDemandForecast ? payload.demand_forecast : [];

  const recommendations = Array.isArray(payload.recommendations) && payload.recommendations.length
    ? payload.recommendations
    : productsAnalysis
      .filter((p) => ['CRITICAL', 'HIGH', 'MEDIUM'].includes(String(p.risk_level || '').toUpperCase()))
      .slice(0, 5)
      .map((p) => p.what || p.WHAT || `Review ${p.product}`);

  const confidenceScore = toNum(payload.confidence_score, 0);

  return {
    ...payload,
    _inventory_validation: inventoryModel.validation,
    _inventory_threshold: inventoryModel.low_stock_threshold,
    products_analysis: productsAnalysis,
    products: Array.isArray(payload.products) && payload.products.length > 0 ? payload.products : products,
    customer_analysis: customerAnalysis,
    customers,
    stock_analysis: stockAnalysis,
    inventory_summary: inventorySummary,
    demand_forecast: demandForecast,
    demand_forecast_is_synthetic: !hasNativeDemandForecast,
    demand_forecast_source: hasNativeDemandForecast
      ? 'analysis'
      : 'insufficient_clean_signal',
    forecast: {
      ...(payload.forecast || {}),
      next_3_months: [1, 2, 3].map((i) => {
        const slice = demandForecast.slice((i - 1) * 4, i * 4);
        return Math.round(slice.reduce((s, r) => s + toNum(r.predicted_demand, 0), 0));
      }),
    },
    sales_summary: {
      ...(payload.sales_summary || {}),
      total_sales: payload.sales_summary?.total_sales ?? inventorySummary.total_sales,
      trend: payload.sales_summary?.trend || payload.forecast_summary?.daily_pattern || 'Stable',
    },
    summary: (inventoryModel.summary && hasSignal(inventoryModel.summary, ['out_of_stock', 'low_stock', 'healthy']))
      ? inventoryModel.summary
      : (payloadSummary || inventoryModel.summary),
    recommendations,
    past_sales_daily: Array.isArray(payload.past_sales_daily) ? payload.past_sales_daily : [],
    past_sales_weekly: Array.isArray(payload.past_sales_weekly) ? payload.past_sales_weekly : [],
    past_sales: Array.isArray(payload.past_sales_daily) ? payload.past_sales_daily : [],
    confidence_score: confidenceScore,
    confidence_label: payload.confidence_label || deriveConfidenceLabel(confidenceScore),
  };
};

const createAnalysisFingerprint = (payload) => {
  if (!payload || typeof payload !== 'object') return '';
  try {
    const serialized = JSON.stringify(payload);
    if (!serialized) return '';
    // Protect UI thread from keeping extremely large keys in memory.
    if (serialized.length > ANALYSIS_FINGERPRINT_MAX_LENGTH) {
      return serialized.slice(0, ANALYSIS_FINGERPRINT_MAX_LENGTH);
    }
    return serialized;
  } catch {
    return '';
  }
};

export const AnalysisProvider = ({ children }) => {
  const resolveStoredAnalysisUploadId = () => {
    try {
      const raw = localStorage.getItem(LAST_ANALYSIS_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const direct = Number(
        parsed?.analysis_isolation?.sheet_id
        || parsed?.analysis_isolation?.upload_id
        || parsed?.metadata?.upload_id
        || 0
      );
      if (Number.isFinite(direct) && direct > 0) return direct;
      const sessionId = String(parsed?.analysis_isolation?.session_id || '');
      const match = sessionId.match(/upload-(\d+)/i);
      if (!match) return null;
      const bySession = Number(match[1]);
      return Number.isFinite(bySession) && bySession > 0 ? bySession : null;
    } catch {
      return null;
    }
  };

  const [analysis, setAnalysisState] = useState(() => {
    try {
      const raw = localStorage.getItem(LAST_ANALYSIS_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return normalizeAnalysisPayload(parsed);
    } catch {
      return null;
    }
  });
  const [latestMeta, setLatestMeta] = useState({ uploadId: null, status: null });
  const [syncState, setSyncState] = useState(() => ({
    status: 'BOOTING', // BOOTING | NO_AUTH | CONNECTED | DEGRADED
    lastSuccessAt: null,
    lastErrorAt: null,
  }));
  const [selectedUploadId, setSelectedUploadId] = useState(() => {
    const raw = localStorage.getItem('ai-ops-selected-upload-id');
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return resolveStoredAnalysisUploadId();
  });
  const latestMetaRef = useRef({ uploadId: null, status: null });
  const analysisRef = useRef(null);
  const analysisKeyRef = useRef('');
  const manualLockUntilRef = useRef(Number(localStorage.getItem('ai-ops-manual-lock-until') || 0));

  const setAnalysis = (value) => {
    if (!value) {
      analysisRef.current = null;
      analysisKeyRef.current = '';
      setAnalysisState(null);
      try {
        localStorage.removeItem(LAST_ANALYSIS_STORAGE_KEY);
      } catch {
        // no-op
      }
      return;
    }
    const normalized = normalizeAnalysisPayload(value);
    const hasManualPayload = Boolean(
      (normalized?.products_analysis && normalized.products_analysis.length)
      || normalized?.sheet_analysis
      || (normalized?.products && normalized.products.length)
      || (normalized?.customers && normalized.customers.length)
      || (normalized?.demand_forecast && normalized.demand_forecast.length)
    );
    if (hasManualPayload) {
      const lockDuration = 10 * 60 * 1000;
      const until = Date.now() + lockDuration;
      manualLockUntilRef.current = until;
      try {
        localStorage.setItem('ai-ops-manual-lock-until', String(until));
      } catch {
        // no-op
      }
    }
    analysisRef.current = normalized;
    analysisKeyRef.current = `manual:${normalized?.analysis_isolation?.session_id || 'coo'}:${normalized?.confidence_score ?? 'na'}:${Date.now()}`;
    setAnalysisState(normalized);
    try {
      localStorage.setItem(LAST_ANALYSIS_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // no-op
    }
  };

  const getAnalysisUploadId = (value) => {
    const sessionId = value?.analysis_isolation?.session_id || '';
    const match = String(sessionId).match(/upload-(\d+)/);
    return match ? Number(match[1]) : null;
  };

  useEffect(() => {
    let timer;
    let cancelled = false;

    const buildAnalysisKey = (payload) => {
      const sessionId = payload?.analysis_isolation?.session_id || 'none';
      const score = payload?.confidence_score ?? 'na';
      const payloadFingerprint = createAnalysisFingerprint(payload);
      return `${sessionId}:${score}:${payloadFingerprint}`;
    };

    const poll = async () => {
      let nextDelayMs = 12000;
      try {
        const token = localStorage.getItem('access_token');
        if (!token) {
          nextDelayMs = 30000;
          setSyncState((prev) => ({
            ...prev,
            status: 'NO_AUTH',
            lastErrorAt: prev.lastErrorAt || Date.now(),
          }));
          return;
        }
        const endpoint = selectedUploadId
          ? `/ingestion/upload-analysis/${selectedUploadId}/`
          : '/ingestion/latest-analysis/';
        const res = await api.get(endpoint, { timeout: ANALYSIS_POLL_TIMEOUT_MS });
        setSyncState((prev) => ({
          ...prev,
          status: 'CONNECTED',
          lastSuccessAt: Date.now(),
        }));
        const nextId = res.data?.upload_id ?? null;
        const nextStatus = res.data?.status ?? null;
        const lockActive = !selectedUploadId && Date.now() < manualLockUntilRef.current;
        const hasStickyAnalysis = Boolean(
          analysisRef.current
          && (
            (Array.isArray(analysisRef.current.customers) && analysisRef.current.customers.length)
            || (Array.isArray(analysisRef.current.customer_analysis) && analysisRef.current.customer_analysis.length)
            || (Array.isArray(analysisRef.current.products) && analysisRef.current.products.length)
            || (Array.isArray(analysisRef.current.products_analysis) && analysisRef.current.products_analysis.length)
          )
        );

        if (!lockActive && !hasStickyAnalysis && nextId && nextId !== latestMetaRef.current.uploadId) {
          // Master Rule: Do NOT clear if we have a valid pinned analysis.
          if (!selectedUploadId) {
            analysisRef.current = null;
            analysisKeyRef.current = '';
            setAnalysisState(null);
            try {
              localStorage.removeItem(LAST_ANALYSIS_STORAGE_KEY);
            } catch {
              // no-op
            }
          }
        }

        const metaChanged = (
          nextId !== latestMetaRef.current.uploadId ||
          nextStatus !== latestMetaRef.current.status
        );
        if (metaChanged) {
          latestMetaRef.current = { uploadId: nextId, status: nextStatus };
          setLatestMeta(latestMetaRef.current);
        }

        if (res.data?.analysis) {
          if (lockActive) {
            return;
          }
          const nextAnalysis = res.data.analysis;
          const nextKey = buildAnalysisKey(nextAnalysis);
          if (analysisKeyRef.current !== nextKey) {
            analysisKeyRef.current = nextKey;
            analysisRef.current = normalizeAnalysisPayload(nextAnalysis);
            setAnalysisState(normalizeAnalysisPayload(nextAnalysis));
            try {
              localStorage.setItem(LAST_ANALYSIS_STORAGE_KEY, JSON.stringify(normalizeAnalysisPayload(nextAnalysis)));
            } catch {
              // no-op
            }
          }

          // For pinned historical uploads that are already completed, poll less frequently.
          if (selectedUploadId && nextStatus === 'COMPLETED') {
            nextDelayMs = 60000;
          }
        } else if (nextStatus && nextStatus !== 'COMPLETED') {
          if (lockActive) {
            nextDelayMs = 12000;
            return;
          }
          const currentAnalysisId = getAnalysisUploadId(analysisRef.current);
          if (!hasStickyAnalysis && (!currentAnalysisId || (nextId && currentAnalysisId !== nextId))) {
            analysisRef.current = null;
            analysisKeyRef.current = '';
            setAnalysisState(null);
            try {
              localStorage.removeItem(LAST_ANALYSIS_STORAGE_KEY);
            } catch {
              // no-op
            }
          }
          nextDelayMs = 12000;
        } else if (selectedUploadId && nextStatus === 'COMPLETED') {
          nextDelayMs = 60000;
        }
      } catch (err) {
        if (selectedUploadId && err?.response?.status === 404) {
          localStorage.removeItem('ai-ops-selected-upload-id');
          setSelectedUploadId(null);
        }
        if (err?.response?.status === 401) {
          analysisRef.current = null;
          analysisKeyRef.current = '';
          latestMetaRef.current = { uploadId: null, status: null };
          setAnalysisState(null);
          setLatestMeta({ uploadId: null, status: null });
          try {
            localStorage.removeItem(LAST_ANALYSIS_STORAGE_KEY);
          } catch {
            // no-op
          }
          localStorage.removeItem('ai-ops-selected-upload-id');
          setSelectedUploadId(null);
        }
        setSyncState((prev) => ({
          ...prev,
          status: localStorage.getItem('access_token') ? 'DEGRADED' : 'NO_AUTH',
          lastErrorAt: Date.now(),
        }));
        // Ignore polling errors; UI will use last known analysis.
        nextDelayMs = 20000;
      } finally {
        if (!cancelled) {
          timer = setTimeout(poll, nextDelayMs);
        }
      }
    };

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [selectedUploadId]);

  const pinUploadAnalysis = async (uploadId) => {
    const parsed = Number(uploadId);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    localStorage.setItem('ai-ops-selected-upload-id', String(parsed));
    setSelectedUploadId(parsed);
    try {
      const res = await api.get(`/ingestion/upload-analysis/${parsed}/`, { timeout: ANALYSIS_POLL_TIMEOUT_MS });
      if (res.data?.analysis) {
        const normalized = normalizeAnalysisPayload(res.data.analysis);
        analysisRef.current = normalized;
        const sessionId = normalized?.analysis_isolation?.session_id || `upload-${parsed}`;
        const score = normalized?.confidence_score ?? 'na';
        const sales = normalized?.sales_summary?.total_sales ?? 'na';
        const low = normalized?.stock_analysis?.low_stock_items ?? 'na';
        const over = normalized?.stock_analysis?.overstock_items ?? 'na';
        analysisKeyRef.current = `${sessionId}:${score}:${sales}:${low}:${over}`;
        setAnalysisState(normalized);
        try {
          localStorage.setItem(LAST_ANALYSIS_STORAGE_KEY, JSON.stringify(normalized));
        } catch {
          // no-op
        }
      }
      const meta = { uploadId: res.data?.upload_id ?? parsed, status: res.data?.status ?? null };
      latestMetaRef.current = meta;
      setLatestMeta(meta);
    } catch {
      // Polling effect will handle recovery paths.
    }
  };

  const clearPinnedUploadAnalysis = () => {
    localStorage.removeItem('ai-ops-selected-upload-id');
    setSelectedUploadId(null);
  };

  const value = useMemo(() => ({
    analysis,
    setAnalysis,
    latestMeta,
    selectedUploadId,
    pinUploadAnalysis,
    clearPinnedUploadAnalysis,
    isLocked: Date.now() < (manualLockUntilRef.current || 0),
    syncState,
  }), [analysis, latestMeta, selectedUploadId, syncState]);

  return (
    <AnalysisContext.Provider value={value}>
      {children}
    </AnalysisContext.Provider>
  );
};
