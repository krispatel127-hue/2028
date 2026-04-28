import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import GlassCard from '../components/GlassCard';
import PredictionChart from '../components/PredictionChart';
import {
  TrendingUp,
  BarChart3,
  Zap,
  Activity,
  Box,
  X,
  Eye,
  List,
  Search,
  ChevronDown,
  Filter,
  Package,
  AlertTriangle,
  TrendingDown,
  Star,
  SlidersHorizontal,
  Clock,
  CheckCircle2,
  Tag,
  Calendar,
  ArrowRight,
  ShieldCheck,
  CircleDollarSign,
  Users,
  Truck,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  LabelList,
  PieChart,
  Pie,
} from 'recharts';
import api from '../api/client';
import { useAnalysis } from '../context/useAnalysis';

// â”€â”€â”€ Status config for forecast items â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


// â”€â”€â”€ Search bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


// â”€â”€â”€ Mini bar chart inside card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


// â”€â”€â”€ Normalization utils â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const normalizeActualRows = (rows = []) =>
  rows.map((d) => ({ period: d.date || d.period || d.name, actual: Number(d.actual ?? d.value ?? d.sales ?? 0) }))
    .filter((row) => row.period);

const normalizeForecastRows = (rows = [], { requireCalendarDate = false, skipSynthetic = false } = {}) =>
  rows.map((d) => ({
    period: d.date || d.period || d.name || 'Data not available',
    predicted: Math.round(Number(d.predicted ?? d.predicted_demand ?? d.value ?? 0)),
    lower: d.lower_bound != null ? Number(d.lower_bound) : Number(d.lower ?? 0),
    upper: d.upper_bound != null ? Number(d.upper_bound) : Number(d.upper ?? 0),
    _synthetic: Boolean(d?._synthetic),
  })).filter((row) => {
    if (!row.period) return false;
    if (skipSynthetic && row._synthetic) return false;
    if (requireCalendarDate && !parseLooseDate(row.period)) return false;
    return true;
  });

const toFiniteNum = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toIsoDay = (date) => {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
});

const aggregateMonthly = (rows = [], { valueKeys = [], mode = 'sum' } = {}) => {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const groups = new Map();

  rows.forEach((row, idx) => {
    const date = parseLooseDate(row?.period || row?.name || row?.date) || new Date();
    if (!date) return;

    const monthDate = new Date(date.getFullYear(), date.getMonth(), 1);
    const key = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;

    if (!groups.has(key)) {
      groups.set(key, {
        totals: Object.fromEntries(valueKeys.map((item) => [item, 0])),
        count: 0,
        order: monthDate.getTime(),
        label: MONTH_LABEL_FORMATTER.format(monthDate),
      });
    }

    const group = groups.get(key);
    valueKeys.forEach((keyName) => {
      const value = Number(row?.[keyName] ?? 0);
      group.totals[keyName] += Number.isFinite(value) ? value : 0;
    });
    group.count += 1;
  });

  return Array.from(groups.values())
    .sort((a, b) => a.order - b.order)
    .map((group) => {
      const aggregated = {};
      valueKeys.forEach((keyName) => {
        aggregated[keyName] = group.count
          ? (mode === 'avg' ? group.totals[keyName] / group.count : group.totals[keyName])
          : 0;
      });

      return {
        period: group.label,
        ...aggregated,
      };
    });
};

const MIN_VALID_ANALYSIS_YEAR = 2020;
const MAX_VALID_ANALYSIS_YEAR = 2100;

const isReasonableAnalysisDate = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
  const year = date.getFullYear();
  return year >= MIN_VALID_ANALYSIS_YEAR && year <= MAX_VALID_ANALYSIS_YEAR;
};

const parseExcelSerialDate = (value) => {
  const serial = Number(value);
  if (!Number.isFinite(serial)) return null;
  if (serial < 30000 || serial > 90000) return null;
  const excelEpoch = new Date(Date.UTC(1899, 11, 30));
  const parsed = new Date(excelEpoch.getTime() + (serial * 86400000));
  return isReasonableAnalysisDate(parsed) ? parsed : null;
};

const parseLooseDate = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    return isReasonableAnalysisDate(value) ? value : null;
  }

  const excelDate = parseExcelSerialDate(value);
  if (excelDate) return excelDate;

  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [yyyy, mm, dd] = raw.split('-').map(Number);
    const parsed = new Date(yyyy, mm - 1, dd);
    return isReasonableAnalysisDate(parsed) ? parsed : null;
  }

  if (/^\d{4}-\d{2}$/.test(raw)) {
    const [yyyy, mm] = raw.split('-').map(Number);
    const parsed = new Date(yyyy, mm - 1, 1);
    return isReasonableAnalysisDate(parsed) ? parsed : null;
  }

  const dmyMatch = raw.match(/^(\d{2})[\/.-](\d{2})[\/.-](\d{4})$/);
  if (dmyMatch) {
    const [, dd, mm, yyyy] = dmyMatch.map(Number);
    const parsed = new Date(yyyy, mm - 1, dd);
    return isReasonableAnalysisDate(parsed) ? parsed : null;
  }

  const dmyTimeMatch = raw.match(/^(\d{2})[\/.-](\d{2})[\/.-](\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (dmyTimeMatch) {
    const [, dd, mm, yyyy, hh, min, ss = '0'] = dmyTimeMatch;
    const parsed = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(ss));
    return isReasonableAnalysisDate(parsed) ? parsed : null;
  }

  const direct = new Date(raw);
  if (isReasonableAnalysisDate(direct)) return direct;

  return null;
};

const SALES_DATE_KEYS = [
  'date', 'order_date', 'sales_date', 'transaction_date', 'invoice_date',
  'bill_date', 'created_at', 'timestamp', 'month',
];

const SALES_VALUE_KEYS = [
  'quantity_sold', 'quantity', 'qty', 'units', 'unit',
  'sale_qty', 'sales_qty', 'sold_qty', 'total_sales',
  'amount', 'value', 'net_amount', 'order_stock', 'order_qty',
];

const toInputDay = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const toInputMonth = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

const extractFestivalCalendarFromAnalysis = (analysisPayload = {}, year) => {
  const selectedYear = Number(year);
  const rawSources = [
    analysisPayload?.festival_calendar,
    analysisPayload?.festivals,
    analysisPayload?.festival_insights,
    analysisPayload?.metadata?.festival_calendar,
    analysisPayload?.metadata?.festivals,
  ];

  const rawRows = rawSources.find((src) => Array.isArray(src) && src.length > 0) || [];
  if (!rawRows.length) return [];

  return rawRows
    .map((row, idx) => {
      const dateRaw = row?.date || row?.festival_date || row?.day || row?.event_date;
      const parsedDate = parseLooseDate(dateRaw);
      if (!parsedDate) return null;
      if (Number.isFinite(selectedYear) && parsedDate.getFullYear() !== selectedYear) return null;

      const name = toSmartTitle(row?.name || row?.festival || row?.event || row?.title);
      if (!name) return null;
      const key = normalizeLookupKey(name || `festival-${idx + 1}`) || `festival-${idx + 1}`;
      return {
        key,
        name,
        category: toSmartTitle(row?.category || row?.type || 'Festival'),
        date: toIsoDay(parsedDate),
        monthKey: toInputMonth(parsedDate),
        tentative: Boolean(row?.tentative),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (parseLooseDate(a.date)?.getTime() || 0) - (parseLooseDate(b.date)?.getTime() || 0));
};

const getRowDate = (row) => parseLooseDate(row?.period || row?.name || row?.date);

const filterRowsByGranularity = (rows = [], granularity, selectedDay, selectedMonth, selectedYear) => {
  return rows.filter((row) => {
    const date = getRowDate(row);
    if (!date) return false;

    if (granularity === 'day') {
      return toIsoDay(date) === selectedDay;
    }

    if (granularity === 'month') {
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      return monthKey === selectedMonth;
    }

    return date.getFullYear() === Number(selectedYear);
  });
};

const getPreviousPeriodSelection = (granularity, selectedDay, selectedMonth, selectedYear) => {
  if (granularity === 'day') {
    const base = parseLooseDate(selectedDay) || new Date();
    const previous = new Date(base);
    previous.setDate(base.getDate() - 1);
    return { selectedDay: toIsoDay(previous), selectedMonth, selectedYear };
  }

  if (granularity === 'month') {
    const [yearPart, monthPart] = String(selectedMonth || '').split('-').map(Number);
    const base = new Date(
      Number.isFinite(yearPart) ? yearPart : new Date().getFullYear(),
      Number.isFinite(monthPart) ? Math.max(monthPart - 1, 0) : new Date().getMonth(),
      1
    );
    base.setMonth(base.getMonth() - 1);
    return {
      selectedDay,
      selectedMonth: toInputMonth(base),
      selectedYear: String(base.getFullYear()),
    };
  }

  return {
    selectedDay,
    selectedMonth,
    selectedYear: String(Number(selectedYear || new Date().getFullYear()) - 1),
  };
};

const sumField = (rows = [], field) => rows.reduce((sum, row) => sum + Number(row?.[field] || 0), 0);

const buildForecastSeriesFromAnalysis = (analysisPayload = {}, pastRows = []) => {
  const normalizedDemand = normalizeForecastRows(analysisPayload?.demand_forecast || [], {
    requireCalendarDate: true,
    skipSynthetic: Boolean(analysisPayload?.demand_forecast_is_synthetic),
  });

  // Strict mode: only explicit date-backed rows from uploaded analysis.
  const merged = new Map();
  normalizedDemand.forEach((row) => {
    const period = String(row?.period || '');
    if (!period) return;
    const existing = merged.get(period) || {};
    merged.set(period, {
      ...existing,
      ...row,
      period,
      predicted: row?.predicted ?? existing?.predicted ?? 0,
      lower: row?.lower ?? existing?.lower ?? 0,
      upper: row?.upper ?? existing?.upper ?? 0,
    });
  });

  return Array.from(merged.values())
    .filter((row) => parseLooseDate(row?.period))
    .sort((a, b) => {
      const da = parseLooseDate(a?.period)?.getTime() || 0;
      const db = parseLooseDate(b?.period)?.getTime() || 0;
      return da - db;
    });
};

const buildForecastProductsFromAnalysis = (analysisPayload) => {
  const rows = Array.isArray(analysisPayload?.demand_forecast)
    ? analysisPayload.demand_forecast.filter((row) => !row?._synthetic)
    : [];
  const products = Array.isArray(analysisPayload?.products) ? analysisPayload.products : [];
  const metaBySku = new Map(
    products.map((p) => [String(p.sku || p.product || p.name || '').toUpperCase(), p])
  );

  const grouped = new Map();
  rows.forEach((row, idx) => {
    const skuRaw = String(row?.sku || row?.product || '').trim();
    const dateRaw = String(row?.date || '').trim();
    if (!skuRaw || !dateRaw) return;
    const sku = skuRaw;
    const key = sku.toUpperCase();
    if (!grouped.has(key)) {
      grouped.set(key, {
        sku,
        name: String(row.product || sku),
        confidence: Number(analysisPayload?.confidence_score || 0),
        weeks: [],
      });
    }
    const entry = grouped.get(key);
    entry.weeks.push({
      date: row.date,
      demand: Math.max(0, Math.round(Number(row.predicted_demand ?? row.predicted ?? 0))),
      production: Math.max(0, Math.round(Number(row.production ?? row.predicted_demand ?? row.predicted ?? 0))),
      low: Number(row.lower_bound ?? row.lower ?? 0),
      high: Number(row.upper_bound ?? row.upper ?? 0),
    });
  });

  let result = Array.from(grouped.values()).map((item) => {
    const meta = metaBySku.get(String(item.sku).toUpperCase()) || {};
    return {
      ...meta,
      ...item,
      name: item.name || meta.name || meta.product || item.sku,
      confidence: Number(meta.confidence ?? meta.score ?? analysisPayload?.confidence_score ?? item.confidence ?? 0),
    };
  });

  return result.filter((item) => Array.isArray(item.weeks) && item.weeks.length > 0);
};

const buildCustomerLeaderboardFromAnalysis = (analysisPayload = {}) => {
  const directCustomers = Array.isArray(analysisPayload?.customers) ? analysisPayload.customers : [];
  const customerAnalysis = Array.isArray(analysisPayload?.customer_analysis)
    ? analysisPayload.customer_analysis
    : (Array.isArray(analysisPayload?.customer_analysis?.customers) ? analysisPayload.customer_analysis.customers : []);

  const merged = new Map();
  const ingest = (customer, index, source = 'analysis') => {
    if (!customer || typeof customer !== 'object') return;
    const name = toSmartTitle(
      customer.customer_name
      || customer.name
      || customer.company
      || customer.party_name
      || customer.party
      || customer.customer
      || customer.buyer_name
      || customer.buyer
    );
    const customerId = cleanTextValue(
      customer.customer_id
      || customer.party_id
      || customer.party_code
      || customer.account_id
      || name
      || `customer-${index + 1}`
    );
    const key = customerId || name;
    if (!key) return;

    const amount = toSafeNumber(customer.total_purchase ?? customer.total_purchased ?? customer.amount ?? customer.value) ?? 0;
    const quantity = toSafeNumber(customer.frequency ?? customer.orders ?? customer.quantity ?? customer.total_units) ?? 0;
    const existing = merged.get(key) || {
      customerName: name || customerId || `Customer ${index + 1}`,
      customerId: customerId || name || `customer-${index + 1}`,
      orders: 0,
      quantity: 0,
      totalAmount: 0,
      pendingAmount: 0,
      latestOrderDate: customer.last_order_date || customer.last_purchase_date || null,
      source,
    };

    existing.customerName = existing.customerName || name || existing.customerId;
    existing.orders = Math.max(existing.orders, Math.round(quantity));
    existing.quantity = Math.max(existing.quantity, Math.round(quantity));
    existing.totalAmount = Math.max(existing.totalAmount, amount);
    existing.latestOrderDate = existing.latestOrderDate || customer.last_order_date || customer.last_purchase_date || null;
    merged.set(key, existing);
  };

  directCustomers.forEach((customer, index) => ingest(customer, index, 'customers'));
  customerAnalysis.forEach((customer, index) => ingest(customer, index, 'customer_analysis'));

  return Array.from(merged.values())
    .filter((entry) => isMeaningfulText(entry.customerName) || isMeaningfulText(entry.customerId))
    .sort((a, b) => (b.totalAmount - a.totalAmount) || (b.quantity - a.quantity))
    .slice(0, 100);
};

const pickFromRow = (row, keys = []) => {
  if (!row || typeof row !== 'object') return null;
  for (const key of keys) {
    const value = getFieldByAliases(row, [key]);
    if (value !== null && value !== undefined && value !== '') {
      return value;
    }
  }
  return null;
};

const derivePastSalesFromPreviewRows = (rows = []) => {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const bucket = new Map();
  rows.forEach((row) => {
    const dateRaw = pickFromRow(row, SALES_DATE_KEYS);
    const dt = parseLooseDate(dateRaw);
    if (!dt) return;

    const qty = toSafeNumber(pickFromRow(row, SALES_VALUE_KEYS));
    if (!Number.isFinite(qty) || qty <= 0) return;

    const key = toIsoDay(dt);
    bucket.set(key, (bucket.get(key) || 0) + qty);
  });

  return Array.from(bucket.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, actual]) => ({ period, actual: Math.round(actual) }));
};

const normalizeLookupKey = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const getFieldByAliases = (row, aliases = []) => {
  if (!row || typeof row !== 'object') return null;
  const normalizedAliases = new Set(aliases.map(normalizeLookupKey));
  const key = Object.keys(row).find((entry) => normalizedAliases.has(normalizeLookupKey(entry)));
  if (!key) return null;
  const value = row[key];
  return value === '' || value === undefined ? null : value;
};

const TEXT_PLACEHOLDERS = new Set(['', 'na', 'n/a', 'null', 'none', '-', '--', 'unknown', 'notavailable']);

const cleanTextValue = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.replace(/\s+/g, ' ');
};

const isMeaningfulText = (value) => {
  const normalized = normalizeLookupKey(cleanTextValue(value));
  return Boolean(normalized && !TEXT_PLACEHOLDERS.has(normalized));
};

const toSmartTitle = (value) => {
  const text = cleanTextValue(value);
  if (!text) return '';
  if (/^[A-Z0-9\s\-_/]+$/.test(text)) {
    return text.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
  }
  return text;
};

const toSafeNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/,/g, '').replace(/[^\d.-]/g, '').trim();
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
};

const formatCurrency = (value) => {
  const amount = Number(value || 0);
  return amount.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  });
};

const formatCompactCurrency = (value) => {
  const amount = Number(value || 0);
  return amount.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    notation: 'compact',
    maximumFractionDigits: 1,
  });
};

const formatFriendlyDate = (value) => {
  const date = parseLooseDate(value);
  if (!date) return '-';
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const formatDeliveryDelta = (orderDate, deliveryDate) => {
  const order = parseLooseDate(orderDate);
  const delivery = parseLooseDate(deliveryDate);
  if (!order || !delivery) return 'Timeline unavailable';
  const diffMs = delivery.getTime() - order.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'Delivered before order date';
  if (diffDays === 0) return 'Delivered same day';
  if (diffDays === 1) return 'Delivered in 1 day';
  return `Delivered in ${diffDays} days`;
};

const HISTORY_CUSTOMER_NAME_ALIASES = [
  'customer_name', 'customer', 'client_name', 'client', 'buyer_name', 'buyer',
  'party_name', 'party', 'account_name', 'company', 'company_name', 'name',
];
const HISTORY_CUSTOMER_ID_ALIASES = [
  'customer_id', 'customerid', 'party_id', 'partycode', 'party_code', 'account_id', 'customer_code',
];
const HISTORY_PRODUCT_ALIASES = [
  'product_name', 'product', 'item_name', 'item', 'material_name', 'sku', 'product_code', 'item_code', 'code',
];
const HISTORY_QTY_ALIASES = [
  'quantity', 'qty', 'units', 'sold_qty', 'sales_qty', 'sale_qty', 'order_qty', 'ordered_qty', 'quantity_sold',
];
const HISTORY_UNIT_PRICE_ALIASES = [
  'unit_price', 'price', 'rate', 'selling_price', 'sale_price', 'mrp', 'unitrate',
];
const HISTORY_TOTAL_ALIASES = [
  'line_total', 'total_amount', 'amount', 'order_value', 'invoice_amount', 'grand_total', 'net_amount', 'total',
];
const HISTORY_PAID_ALIASES = [
  'amount_paid', 'paid_amount', 'payment_received', 'received_amount', 'paid', 'payment', 'payment_done', 'received',
];
const HISTORY_BALANCE_ALIASES = [
  'balance', 'balance_amount', 'pending_amount', 'amount_due', 'due_amount', 'remaining_amount', 'outstanding', 'baki',
];
const HISTORY_PAYMENT_STATUS_ALIASES = [
  'payment_status', 'payment_state', 'status', 'paid_status', 'bill_status',
];
const HISTORY_ORDER_DATE_ALIASES = [
  'order_date', 'sales_date', 'transaction_date', 'invoice_date', 'date', 'record_date', 'posting_date',
];
const HISTORY_DELIVERY_DATE_ALIASES = [
  'delivery_date', 'delivered_date', 'delivery', 'dispatch_date', 'dispatched_date', 'ship_date',
];
const HISTORY_DIRECTION_ALIASES = [
  'type', 'transaction_type', 'txn_type', 'movement', 'movement_type', 'in_out', 'in/out',
];
const HISTORY_ORDER_ID_ALIASES = [
  'order_id', 'invoice_no', 'invoice_number', 'bill_no', 'bill_number', 'voucher_no', 'order_no',
];

const isSalesHistoryRow = (row) => {
  const direction = cleanTextValue(getFieldByAliases(row, HISTORY_DIRECTION_ALIASES)).toUpperCase();
  if (direction) {
    if (
      direction.includes('PURCHASE')
      || direction.includes('RECEIPT')
      || direction.includes('OPENING')
      || direction === 'IN'
    ) {
      return false;
    }
    if (
      direction.includes('SALE')
      || direction.includes('OUT')
      || direction.includes('DELIVERY')
      || direction.includes('DISPATCH')
      || direction.includes('INVOICE')
    ) {
      return true;
    }
  }

  const customerName = getFieldByAliases(row, HISTORY_CUSTOMER_NAME_ALIASES);
  const qty = toSafeNumber(getFieldByAliases(row, HISTORY_QTY_ALIASES));
  const product = getFieldByAliases(row, HISTORY_PRODUCT_ALIASES);
  return isMeaningfulText(customerName) && isMeaningfulText(product) && Number.isFinite(qty) && qty > 0;
};

const collectHistorySourceRows = (analysisPayload = {}) => {
  const nestedAnalysis = extractAnalysisPayload(analysisPayload) || {};
  const directRows = [
    ...(Array.isArray(analysisPayload?.raw_transactions) ? analysisPayload.raw_transactions : []),
    ...(Array.isArray(analysisPayload?.transactions) ? analysisPayload.transactions : []),
    ...(Array.isArray(analysisPayload?.preview_rows) ? analysisPayload.preview_rows : []),
    ...(Array.isArray(nestedAnalysis?.raw_transactions) ? nestedAnalysis.raw_transactions : []),
    ...(Array.isArray(nestedAnalysis?.transactions) ? nestedAnalysis.transactions : []),
    ...(Array.isArray(nestedAnalysis?.preview_rows) ? nestedAnalysis.preview_rows : []),
  ];

  const previewRows = [
    ...(Array.isArray(analysisPayload?.metadata?.sheet_previews) ? analysisPayload.metadata.sheet_previews : []),
    ...(Array.isArray(nestedAnalysis?.metadata?.sheet_previews) ? nestedAnalysis.metadata.sheet_previews : []),
  ].flatMap((sheet) => (Array.isArray(sheet?.rows) ? sheet.rows : []));

  const deduped = new Map();
  [...directRows, ...previewRows].forEach((row, index) => {
    if (!row || typeof row !== 'object') return;
    const key = JSON.stringify(row);
    if (!deduped.has(key)) {
      deduped.set(key, { ...row, __sourceIndex: index });
    }
  });

  return Array.from(deduped.values());
};

const buildHistoryRowsFromAnalysis = (analysisPayload = {}) => {
  const rows = collectHistorySourceRows(analysisPayload);

  return rows
    .filter(isSalesHistoryRow)
    .map((row, index) => {
      const quantity = Math.max(0, toSafeNumber(getFieldByAliases(row, HISTORY_QTY_ALIASES)) || 0);
      const unitPrice = toSafeNumber(getFieldByAliases(row, HISTORY_UNIT_PRICE_ALIASES));
      const explicitTotal = toSafeNumber(getFieldByAliases(row, HISTORY_TOTAL_ALIASES));
      const totalAmount = explicitTotal ?? (unitPrice != null ? quantity * unitPrice : null);
      const explicitPaid = toSafeNumber(getFieldByAliases(row, HISTORY_PAID_ALIASES));
      const explicitBalance = toSafeNumber(getFieldByAliases(row, HISTORY_BALANCE_ALIASES));
      const paymentStatusRaw = cleanTextValue(getFieldByAliases(row, HISTORY_PAYMENT_STATUS_ALIASES)).toLowerCase();

      const paidAmount = explicitPaid != null
        ? explicitPaid
        : (
          totalAmount != null && explicitBalance != null
            ? Math.max(totalAmount - explicitBalance, 0)
            : (
              totalAmount != null && /(paid|complete|settled|received full)/.test(paymentStatusRaw)
                ? totalAmount
                : null
            )
        );
      const pendingAmount = explicitBalance != null
        ? explicitBalance
        : (
          totalAmount != null && paidAmount != null
            ? Math.max(totalAmount - paidAmount, 0)
            : null
        );

      let paymentStatus = 'Pending';
      if (/(partial|part payment|advance)/.test(paymentStatusRaw)) {
        paymentStatus = 'Partial';
      } else if (/(paid|complete|settled|clear|closed)/.test(paymentStatusRaw)) {
        paymentStatus = 'Paid';
      } else if (paidAmount != null && totalAmount != null) {
        if (pendingAmount <= 0) paymentStatus = 'Paid';
        else if (paidAmount > 0) paymentStatus = 'Partial';
      }

      const customerName = toSmartTitle(
        getFieldByAliases(row, HISTORY_CUSTOMER_NAME_ALIASES)
        || getFieldByAliases(row, HISTORY_CUSTOMER_ID_ALIASES)
      );
      if (!customerName) return null;
      const customerId = cleanTextValue(getFieldByAliases(row, HISTORY_CUSTOMER_ID_ALIASES)) || customerName;
      const stockName = toSmartTitle(getFieldByAliases(row, HISTORY_PRODUCT_ALIASES));
      if (!stockName) return null;
      const orderDate = cleanTextValue(getFieldByAliases(row, HISTORY_ORDER_DATE_ALIASES));
      const deliveryDate = cleanTextValue(getFieldByAliases(row, HISTORY_DELIVERY_DATE_ALIASES));
      const effectiveDate = parseLooseDate(orderDate) || parseLooseDate(deliveryDate);

      return {
        id: `${customerId}-${stockName}-${orderDate || deliveryDate || index}`,
        customerId,
        customerName,
        stockName,
        quantity,
        unitPrice,
        totalAmount,
        paidAmount,
        pendingAmount,
        paymentStatus,
        orderDate,
        deliveryDate,
        effectiveDate,
        orderId: cleanTextValue(getFieldByAliases(row, HISTORY_ORDER_ID_ALIASES)),
      };
    }).filter(Boolean)
    .filter((row) => row.effectiveDate && row.quantity > 0)
    .sort((a, b) => (b.effectiveDate?.getTime() || 0) - (a.effectiveDate?.getTime() || 0));
};

const filterHistoryRowsByGranularity = (rows = [], granularity, selectedDay, selectedMonth, selectedYear) => {
  return rows.filter((row) => {
    const date = row?.effectiveDate;
    if (!date) return false;
    if (granularity === 'day') return toIsoDay(date) === selectedDay;
    if (granularity === 'month') return toInputMonth(date) === selectedMonth;
    return String(date.getFullYear()) === String(selectedYear);
  });
};

const summarizeHistoryRows = (rows = []) => {
  const totals = rows.reduce((acc, row) => {
    acc.quantity += Number(row?.quantity || 0);
    acc.totalAmount += Number(row?.totalAmount || 0);
    acc.paidAmount += Number(row?.paidAmount || 0);
    acc.pendingAmount += Number(row?.pendingAmount || 0);
    if (row?.paymentStatus === 'Paid') acc.paidOrders += 1;
    if (row?.paymentStatus === 'Partial') acc.partialOrders += 1;
    if (row?.paymentStatus === 'Pending') acc.pendingOrders += 1;
    acc.customers.add(row?.customerId || row?.customerName || '');
    acc.stocks.add(row?.stockName || '');
    return acc;
  }, {
    quantity: 0,
    totalAmount: 0,
    paidAmount: 0,
    pendingAmount: 0,
    paidOrders: 0,
    partialOrders: 0,
    pendingOrders: 0,
    customers: new Set(),
    stocks: new Set(),
  });

  return {
    ...totals,
    customerCount: Array.from(totals.customers).filter(Boolean).length,
    stockCount: Array.from(totals.stocks).filter(Boolean).length,
  };
};

const getAnalysisProducts = (analysisPayload = {}) => {
  const sources = [
    analysisPayload?.products,
    analysisPayload?.products_analysis,
    analysisPayload?.inventory_products,
    analysisPayload?.inventory_summary?.products,
    analysisPayload?.summary?.products,
  ];

  for (const source of sources) {
    if (Array.isArray(source) && source.length > 0) {
      return source;
    }
  }

  return [];
};

const sumCurrentStockFromProducts = (products = []) => products.reduce((sum, product) => {
  const stockValue = toSafeNumber(
    product?.current_stock
    ?? product?.on_hand
    ?? product?.stock
    ?? product?.inventory
    ?? product?.quantity_on_hand
    ?? product?.qty_on_hand
    ?? product?.available_stock
    ?? product?.closing_stock
  );
  return sum + (Number.isFinite(stockValue) ? stockValue : 0);
}, 0);

const DAY_TIMELINE_TIMESTAMP_ALIASES = [
  'timestamp', 'datetime', 'date_time', 'transaction_datetime', 'invoice_datetime', 'created_at', 'updated_at',
];
const DAY_TIMELINE_TIME_ALIASES = [
  'time', 'bill_time', 'transaction_time', 'invoice_time', 'order_time', 'created_time',
];
const DAY_TIMELINE_STOCK_ALIASES = [
  'current_stock', 'stock', 'on_hand', 'qty_on_hand', 'available_stock', 'stock_balance',
  'remaining_stock', 'closing_stock', 'balance_qty', 'available',
];

const parseDetailedDateTime = (value) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const raw = String(value).trim();
  if (!raw) return null;

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;

  const normalized = raw.replace(/\./g, '-').replace(/\//g, '-').replace('T', ' ');
  const dmyMatch = normalized.match(/^(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dmyMatch) {
    const [, dd, mm, yyyy, hh = '0', min = '0', ss = '0'] = dmyMatch;
    const parsed = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(ss));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const ymdMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (ymdMatch) {
    const [, yyyy, mm, dd, hh = '0', min = '0', ss = '0'] = ymdMatch;
    const parsed = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(ss));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
};

const getRowDateTime = (row) => {
  const timestampValue = getFieldByAliases(row, DAY_TIMELINE_TIMESTAMP_ALIASES);
  const parsedTimestamp = parseDetailedDateTime(timestampValue);
  if (parsedTimestamp) return parsedTimestamp;

  const dateValue = getFieldByAliases(row, HISTORY_ORDER_DATE_ALIASES) || getFieldByAliases(row, SALES_DATE_KEYS);
  const timeValue = getFieldByAliases(row, DAY_TIMELINE_TIME_ALIASES);
  if (dateValue && timeValue) {
    const combined = parseDetailedDateTime(`${dateValue} ${timeValue}`);
    if (combined) return combined;
  }

  return parseDetailedDateTime(dateValue);
};

const formatHourLabel = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
};

const buildDayTimelineRowsFromAnalysis = (analysisPayload = {}, selectedDay) => {
  const rows = collectHistorySourceRows(analysisPayload);

  return rows
    .filter(isSalesHistoryRow)
    .map((row, index) => {
      const timestamp = getRowDateTime(row);
      if (!timestamp || toIsoDay(timestamp) !== selectedDay) return null;

      const quantity = Math.max(0, toSafeNumber(getFieldByAliases(row, HISTORY_QTY_ALIASES)) || 0);
      if (quantity <= 0) return null;

      const unitPrice = toSafeNumber(getFieldByAliases(row, HISTORY_UNIT_PRICE_ALIASES));
      const amount = toSafeNumber(getFieldByAliases(row, HISTORY_TOTAL_ALIASES)) ?? (unitPrice != null ? quantity * unitPrice : 0);
      const stockLeft = toSafeNumber(getFieldByAliases(row, DAY_TIMELINE_STOCK_ALIASES));

      return {
        id: `day-line-${index}-${timestamp.getTime()}`,
        timestamp,
        timeLabel: formatHourLabel(timestamp),
        hourKey: `${String(timestamp.getHours()).padStart(2, '0')}:00`,
        customerName: toSmartTitle(
          getFieldByAliases(row, HISTORY_CUSTOMER_NAME_ALIASES)
          || getFieldByAliases(row, HISTORY_CUSTOMER_ID_ALIASES)
          || 'Direct Customer'
        ),
        stockName: toSmartTitle(getFieldByAliases(row, HISTORY_PRODUCT_ALIASES) || 'Unknown Stock'),
        quantity,
        amount,
        stockLeft,
        orderId: cleanTextValue(getFieldByAliases(row, HISTORY_ORDER_ID_ALIASES)) || 'Auto-detected',
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.timestamp?.getTime() || 0) - (b.timestamp?.getTime() || 0));
};

const buildHourlySalesBuckets = (rows = []) => {
  const byHour = new Map();

  rows.forEach((row) => {
    const key = row.hourKey || 'Unknown';
    if (!byHour.has(key)) {
      byHour.set(key, {
        hourKey: key,
        quantity: 0,
        amount: 0,
        stockLeft: null,
        orderCount: 0,
        items: new Set(),
      });
    }

    const bucket = byHour.get(key);
    bucket.quantity += Number(row.quantity || 0);
    bucket.amount += Number(row.amount || 0);
    bucket.orderCount += 1;
    if (row.stockName) bucket.items.add(row.stockName);
    if (row.stockLeft != null) bucket.stockLeft = row.stockLeft;
  });

  return Array.from(byHour.values())
    .sort((a, b) => a.hourKey.localeCompare(b.hourKey))
    .map((bucket) => ({
      ...bucket,
      itemCount: bucket.items.size,
    }));
};

const summarizeDayTimeline = (rows = []) => {
  const hours = new Set();
  let stockSnapshots = 0;

  const summary = rows.reduce((acc, row) => {
    acc.quantity += Number(row.quantity || 0);
    acc.amount += Number(row.amount || 0);
    acc.orders += 1;
    hours.add(row.hourKey);
    if (row.stockLeft != null) {
      acc.latestStockLeft = row.stockLeft;
      stockSnapshots += 1;
    }
    return acc;
  }, {
    quantity: 0,
    amount: 0,
    orders: 0,
    latestStockLeft: null,
  });

  return {
    ...summary,
    activeHours: hours.size,
    stockSnapshots,
  };
};

const extractAnalysisPayload = (payload) => {
  if (!payload) return null;
  if (payload.analysis && typeof payload.analysis === 'object') return payload.analysis;
  if (payload.payload?.analysis && typeof payload.payload.analysis === 'object') return payload.payload.analysis;
  if (typeof payload === 'object') return payload;
  return null;
};

const hasUsableForecastPayload = (payload) => {
  const analysisPayload = extractAnalysisPayload(payload);
  if (!analysisPayload || typeof analysisPayload !== 'object') return false;

  const normalizedPastDaily = normalizeActualRows(analysisPayload?.past_sales_daily || analysisPayload?.past_sales || []);
  const derivedPastDaily = derivePastSalesFromPreviewRows(collectHistorySourceRows(analysisPayload));
  const effectivePastDaily = normalizedPastDaily.length ? normalizedPastDaily : derivedPastDaily;
  const derivedForecastRows = buildForecastSeriesFromAnalysis(analysisPayload, effectivePastDaily);

  return Boolean(
    effectivePastDaily.length
    || (Array.isArray(analysisPayload?.past_sales_weekly) && analysisPayload.past_sales_weekly.length)
    || derivedForecastRows.length
  );
};

// â”€â”€â”€ Main Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const ForecastViewer = () => {
  const {
    analysis: liveAnalysis,
    selectedUploadId,
    latestMeta,
    pinUploadAnalysis,
  } = useAnalysis();
  const autoPinnedUploadRef = useRef(null);
  const [auditData, setAuditData] = useState({ aggregate_accuracy: 0, stability: 'Analyzing...', recommendation: '' });
  const [forecasts, setForecasts] = useState([]);
  const [pastDailyData, setPastDailyData] = useState([]);
  const [pastWeeklyData, setPastWeeklyData] = useState([]);
  const [forecastRawData, setForecastRawData] = useState([]);
  const [historySourcePayload, setHistorySourcePayload] = useState(null);
  const [forecastQuality, setForecastQuality] = useState({
    signalReady: true,
    source: 'unknown',
    qualityScore: 0,
    dateCoverage: 0,
    signalRatio: 0,
  });
  const [loading, setLoading] = useState(true);
  const [forecastMode, setForecastMode] = useState('future');
  const [timeGranularity, setTimeGranularity] = useState('month');
  const [forecastViewMode, setForecastViewMode] = useState('chart');
  const [selectedDay, setSelectedDay] = useState(() => toInputDay(new Date()));
  const [selectedMonth, setSelectedMonth] = useState(() => toInputMonth(new Date()));
  const [selectedYear, setSelectedYear] = useState(() => String(new Date().getFullYear()));
  const [historySearchTerm, setHistorySearchTerm] = useState('');
  const [showTrends, setShowTrends] = useState(false);
  const [showAllTrends, setShowAllTrends] = useState(false);
  const [showFestivalPopup, setShowFestivalPopup] = useState(false);
  const [festivalSelectedYear, setFestivalSelectedYear] = useState(() => String(new Date().getFullYear()));
  const [festivalViewMode, setFestivalViewMode] = useState('year');
  const [festivalTimelineFilter, setFestivalTimelineFilter] = useState('all');
  const [festivalSelectedMonth, setFestivalSelectedMonth] = useState('all');
  const [festivalSelectedKey, setFestivalSelectedKey] = useState('all');
  const [festivalStockFocusKey, setFestivalStockFocusKey] = useState('all');
  const [selectedHistoryProduct, setSelectedHistoryProduct] = useState(null);
  const [showProductHistory, setShowProductHistory] = useState(false);
  const [customerLeaderboardView, setCustomerLeaderboardView] = useState('top5');
  const [trendTimeGranularity, setTrendTimeGranularity] = useState('day');
  const [trendSelectedDay, setTrendSelectedDay] = useState(() => toInputDay(new Date()));
  const [trendSelectedMonth, setTrendSelectedMonth] = useState(() => toInputMonth(new Date()));
  const [trendSelectedYear, setTrendSelectedYear] = useState(() => String(new Date().getFullYear()));
  const analysisPayload = useMemo(() => extractAnalysisPayload(liveAnalysis), [liveAnalysis]);

  const applyAnalysisPayload = (analysisPayload, sourcePayload = null) => {
    const effectiveSourcePayload = sourcePayload || analysisPayload || {};
    const normalizedPastDaily = normalizeActualRows(analysisPayload?.past_sales_daily || analysisPayload?.past_sales || []);
    const derivedPastDaily = derivePastSalesFromPreviewRows(collectHistorySourceRows(effectiveSourcePayload));
    const finalPastDaily = normalizedPastDaily.length ? normalizedPastDaily : derivedPastDaily;

    setPastDailyData(finalPastDaily);
    setPastWeeklyData(normalizeActualRows(analysisPayload?.past_sales_weekly || []));
    setForecastRawData(buildForecastSeriesFromAnalysis(analysisPayload, finalPastDaily));
    setForecasts(buildForecastProductsFromAnalysis(analysisPayload));
    setHistorySourcePayload(effectiveSourcePayload);
    const quality = analysisPayload?.metadata?.forecast_quality || {};
    setForecastQuality({
      signalReady: Boolean(analysisPayload?.metadata?.forecast_signal_ready ?? true),
      source: String(analysisPayload?.demand_forecast_source || 'unknown'),
      qualityScore: Number(quality?.quality_score || 0),
      dateCoverage: Number(quality?.date_coverage_ratio || 0),
      signalRatio: Number(quality?.sales_signal_ratio || 0),
    });
    setAuditData({
      aggregate_accuracy: Number(analysisPayload?.confidence_score || 0),
      stability: analysisPayload?.confidence_label || analysisPayload?.metadata?.confidence || 'Data not available',
      recommendation: Array.isArray(analysisPayload?.recommendations) && analysisPayload.recommendations.length
        ? analysisPayload.recommendations[0]
        : 'Data not available',
    });
  };

  useEffect(() => {
    const payload = analysisPayload;
    if (!hasUsableForecastPayload(payload)) return;
    applyAnalysisPayload(payload, payload);
    setLoading(false);
  }, [analysisPayload]);

  const historyRows = useMemo(
    () => buildHistoryRowsFromAnalysis(historySourcePayload || analysisPayload || {}),
    [historySourcePayload, analysisPayload]
  );

  const basePastRows = useMemo(
    () => (pastDailyData.length ? pastDailyData : pastWeeklyData),
    [pastDailyData, pastWeeklyData]
  );

  const pastFilterRows = useMemo(() => {
    const historyAsRows = historyRows.map((row) => ({ period: row?.effectiveDate }));
    return [...basePastRows, ...historyAsRows];
  }, [basePastRows, historyRows]);

  const availableYears = useMemo(() => {
    const years = new Set();
    const activeRows = forecastMode === 'past'
      ? pastFilterRows
      : (forecastMode === 'future' ? forecastRawData : [...pastFilterRows, ...forecastRawData]);

    activeRows.forEach((row) => {
      const date = getRowDate(row);
      if (date) years.add(date.getFullYear());
    });

    if (!years.size) {
      return [new Date().getFullYear()];
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [forecastMode, pastFilterRows, forecastRawData]);

  const availableTrendYears = useMemo(() => {
    const years = new Set();
    pastDailyData.forEach((row) => {
      const date = getRowDate(row);
      if (date) years.add(date.getFullYear());
    });
    if (!years.size) {
      return [new Date().getFullYear()];
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [pastDailyData]);

  useEffect(() => {
    if (!availableYears.length) return;
    if (!availableYears.includes(Number(selectedYear))) {
      setSelectedYear(String(availableYears[0]));
    }
  }, [availableYears, selectedYear]);

  useEffect(() => {
    if (!availableTrendYears.length) return;
    if (!availableTrendYears.includes(Number(trendSelectedYear))) {
      setTrendSelectedYear(String(availableTrendYears[0]));
    }
  }, [availableTrendYears, trendSelectedYear]);

  const displayForecastData = useMemo(() => {
    const filteredRows = filterRowsByGranularity(
      forecastRawData,
      timeGranularity,
      selectedDay,
      selectedMonth,
      selectedYear
    );
    if (timeGranularity === 'year') {
      return aggregateMonthly(filteredRows, { valueKeys: ['predicted', 'lower', 'upper'], mode: 'sum' });
    }
    return filteredRows;
  }, [forecastRawData, timeGranularity, selectedDay, selectedMonth, selectedYear]);

  const previousSelection = useMemo(
    () => getPreviousPeriodSelection(timeGranularity, selectedDay, selectedMonth, selectedYear),
    [timeGranularity, selectedDay, selectedMonth, selectedYear]
  );

  const trendSalesRows = useMemo(() => {
    const filtered = filterRowsByGranularity(
      pastDailyData,
      trendTimeGranularity,
      trendSelectedDay,
      trendSelectedMonth,
      trendSelectedYear
    );

    if (trendTimeGranularity === 'year') {
      return aggregateMonthly(filtered, { valueKeys: ['actual'], mode: 'sum' });
    }

    return [...filtered].sort((a, b) => {
      const dateA = getRowDate(a)?.getTime() || 0;
      const dateB = getRowDate(b)?.getTime() || 0;
      return dateA - dateB;
    });
  }, [pastDailyData, trendTimeGranularity, trendSelectedDay, trendSelectedMonth, trendSelectedYear]);

  const trendSalesTotal = useMemo(
    () => trendSalesRows.reduce((sum, row) => sum + Number(row?.actual || 0), 0),
    [trendSalesRows]
  );

  const productSpecificHistory = useMemo(() => {
    if (!selectedHistoryProduct) return [];
    const normalizedSelected = String(selectedHistoryProduct).toLowerCase();
    return historyRows.filter(row => 
      String(row.stockName || '').toLowerCase() === normalizedSelected
    );
  }, [historyRows, selectedHistoryProduct]);

  const selectedProductMeta = useMemo(() => {
    if (!selectedHistoryProduct) return null;
    const normalizedSelected = String(selectedHistoryProduct).toLowerCase();
    return forecasts.find(p => 
      String(p.name || p.sku || '').toLowerCase() === normalizedSelected
    );
  }, [forecasts, selectedHistoryProduct]);

  const dayTimelineRows = useMemo(
    () => buildDayTimelineRowsFromAnalysis(historySourcePayload || analysisPayload || {}, selectedDay),
    [historySourcePayload, analysisPayload, selectedDay]
  );

  const hourlySalesBuckets = useMemo(
    () => buildHourlySalesBuckets(dayTimelineRows),
    [dayTimelineRows]
  );

  const dayTimelineSummary = useMemo(
    () => summarizeDayTimeline(dayTimelineRows),
    [dayTimelineRows]
  );

  const displayPastData = useMemo(() => {
    if (timeGranularity === 'day' && hourlySalesBuckets.length > 0) {
      return hourlySalesBuckets.map((bucket) => ({
        period: bucket.hourKey,
        actual: Number(bucket.quantity || 0),
        amount: Number(bucket.amount || 0),
        stockLeft: bucket.stockLeft,
        orderCount: bucket.orderCount,
      }));
    }

    const sourceRows = pastDailyData.length ? pastDailyData : pastWeeklyData;
    const filteredRows = filterRowsByGranularity(
      sourceRows,
      timeGranularity,
      selectedDay,
      selectedMonth,
      selectedYear
    );

    if (timeGranularity === 'year') {
      return aggregateMonthly(filteredRows, { valueKeys: ['actual'], mode: 'sum' });
    }
    return filteredRows;
  }, [pastDailyData, pastWeeklyData, timeGranularity, selectedDay, selectedMonth, selectedYear, hourlySalesBuckets]);

  const combinedWindowRows = useMemo(() => {
    const rowsMap = new Map();

    displayPastData.forEach((row) => {
      const key = String(row?.period || '');
      if (!key) return;
      rowsMap.set(key, {
        period: key,
        actual: Number(row?.actual || 0),
        predicted: null,
        lower: null,
        upper: null,
      });
    });

    displayForecastData.forEach((row) => {
      const key = String(row?.period || '');
      if (!key) return;
      const existing = rowsMap.get(key) || {
        period: key,
        actual: null,
        predicted: null,
        lower: null,
        upper: null,
      };
      rowsMap.set(key, {
        ...existing,
        predicted: Number(row?.predicted || 0),
        lower: row?.lower != null ? Number(row.lower) : null,
        upper: row?.upper != null ? Number(row.upper) : null,
      });
    });

    return Array.from(rowsMap.values());
  }, [displayPastData, displayForecastData]);

  const comparisonMetrics = useMemo(() => {
    const sourcePast = pastDailyData.length ? pastDailyData : pastWeeklyData;
    const previousPast = filterRowsByGranularity(
      sourcePast,
      timeGranularity,
      previousSelection.selectedDay,
      previousSelection.selectedMonth,
      previousSelection.selectedYear
    );
    const previousFuture = filterRowsByGranularity(
      forecastRawData,
      timeGranularity,
      previousSelection.selectedDay,
      previousSelection.selectedMonth,
      previousSelection.selectedYear
    );

    const currentPastValue = sumField(displayPastData, 'actual');
    const currentFutureValue = sumField(displayForecastData, 'predicted');
    const previousPastValue = sumField(previousPast, 'actual');
    const previousFutureValue = sumField(previousFuture, 'predicted');

    const currentValue = forecastMode === 'past'
      ? currentPastValue
      : (forecastMode === 'future' ? currentFutureValue : currentPastValue + currentFutureValue);
    const previousValue = forecastMode === 'past'
      ? previousPastValue
      : (forecastMode === 'future' ? previousFutureValue : previousPastValue + previousFutureValue);

    const delta = currentValue - previousValue;
    const deltaPct = previousValue > 0 ? (delta / previousValue) * 100 : null;

    return {
      currentValue,
      previousValue,
      delta,
      deltaPct,
    };
  }, [
    pastDailyData,
    pastWeeklyData,
    forecastRawData,
    timeGranularity,
    previousSelection,
    displayPastData,
    displayForecastData,
    forecastMode,
  ]);

  const availableMonths = useMemo(() => {
    const months = new Set();
    const activeRows = forecastMode === 'past'
      ? pastFilterRows
      : (forecastMode === 'future' ? forecastRawData : [...pastFilterRows, ...forecastRawData]);

    activeRows.forEach((row) => {
      const date = getRowDate(row);
      if (date) months.add(toInputMonth(date));
    });

    return Array.from(months).sort().reverse();
  }, [forecastMode, pastFilterRows, forecastRawData]);

  const availableDays = useMemo(() => {
    const days = new Set();
    const activeRows = forecastMode === 'past'
      ? pastFilterRows
      : (forecastMode === 'future' ? forecastRawData : [...pastFilterRows, ...forecastRawData]);

    activeRows.forEach((row) => {
      const date = getRowDate(row);
      if (date) days.add(toIsoDay(date));
    });

    return Array.from(days).sort().reverse();
  }, [forecastMode, pastFilterRows, forecastRawData]);

  useEffect(() => {
    if (!availableMonths.length) return;
    if (!availableMonths.includes(selectedMonth)) {
      setSelectedMonth(availableMonths[0]);
    }
  }, [availableMonths, selectedMonth]);

  useEffect(() => {
    if (!availableDays.length) return;
    if (!availableDays.includes(selectedDay)) {
      setSelectedDay(availableDays[0]);
    }
  }, [availableDays, selectedDay]);

  const filteredHistoryRows = useMemo(() => {
    const scopedRows = filterHistoryRowsByGranularity(
      historyRows,
      timeGranularity,
      selectedDay,
      selectedMonth,
      selectedYear
    );

    const query = cleanTextValue(historySearchTerm).toLowerCase();
    if (!query) return scopedRows;

    return scopedRows.filter((row) => {
      const matchText = [
        row.customerName,
        row.customerId,
        row.stockName,
        row.orderId,
      ].join(' ').toLowerCase();
      return matchText.includes(query);
    });
  }, [historyRows, timeGranularity, selectedDay, selectedMonth, selectedYear, historySearchTerm]);

  const fallbackTableRows = useMemo(() => [], []);

  const tableRowsToRender = filteredHistoryRows;

  const availableHistoryDays = useMemo(() => {
    const days = new Set();
    historyRows.forEach((row) => {
      if (row?.effectiveDate) days.add(toIsoDay(row.effectiveDate));
    });
    return Array.from(days).sort().reverse();
  }, [historyRows]);

  const availableHistoryMonths = useMemo(() => {
    const months = new Set();
    historyRows.forEach((row) => {
      if (row?.effectiveDate) months.add(toInputMonth(row.effectiveDate));
    });
    return Array.from(months).sort().reverse();
  }, [historyRows]);

  const availableHistoryYears = useMemo(() => {
    const years = new Set();
    historyRows.forEach((row) => {
      if (row?.effectiveDate) years.add(String(row.effectiveDate.getFullYear()));
    });
    return Array.from(years).sort().reverse();
  }, [historyRows]);

  useEffect(() => {
    if (forecastViewMode !== 'table') return;
    if (forecastMode === 'future') return;
    if (cleanTextValue(historySearchTerm)) return;
    if (filteredHistoryRows.length > 0) return;

    if (timeGranularity === 'day' && availableHistoryDays.length && selectedDay !== availableHistoryDays[0]) {
      setSelectedDay(availableHistoryDays[0]);
      return;
    }
    if (timeGranularity === 'month' && availableHistoryMonths.length && selectedMonth !== availableHistoryMonths[0]) {
      setSelectedMonth(availableHistoryMonths[0]);
      return;
    }
    if (timeGranularity === 'year' && availableHistoryYears.length && selectedYear !== availableHistoryYears[0]) {
      setSelectedYear(availableHistoryYears[0]);
    }
  }, [
    forecastViewMode,
    forecastMode,
    historySearchTerm,
    filteredHistoryRows.length,
    timeGranularity,
    availableHistoryDays,
    availableHistoryMonths,
    availableHistoryYears,
    selectedDay,
    selectedMonth,
    selectedYear,
  ]);

  const historySummary = useMemo(
    () => summarizeHistoryRows(filteredHistoryRows),
    [filteredHistoryRows]
  );

  const globalRowsForCards = useMemo(() => historyRows, [historyRows]);

  const globalHistorySummary = useMemo(
    () => summarizeHistoryRows(globalRowsForCards),
    [globalRowsForCards]
  );

  const forecastStats = useMemo(() => {
    const historical = displayPastData.filter(r => r.actual != null);
    const forecast = displayForecastData.filter(r => r.predicted != null);
    const forecastAll = forecastRawData.filter((r) => r.predicted != null);

    const latestSales = historical.length > 0 ? historical[historical.length - 1].actual : 0;
    const avgForecast = (forecast.length > 0 || forecastAll.length > 0)
      ? Math.round((forecast.length > 0 ? forecast : forecastAll).reduce((sum, r) => sum + (r.predicted || 0), 0) / (forecast.length > 0 ? forecast.length : forecastAll.length))
      : 0;
    const peakForecast = forecast.length > 0
      ? Math.max(...forecast.map(r => r.predicted || 0))
      : 0;

    return { latestSales, avgForecast, peakForecast };
  }, [displayPastData, displayForecastData, forecastRawData]);

  const scopedHistoryRows = useMemo(
    () => filterHistoryRowsByGranularity(historyRows, timeGranularity, selectedDay, selectedMonth, selectedYear),
    [historyRows, timeGranularity, selectedDay, selectedMonth, selectedYear]
  );

  const scopedForecastRows = useMemo(
    () => filterRowsByGranularity(forecastRawData, timeGranularity, selectedDay, selectedMonth, selectedYear),
    [forecastRawData, timeGranularity, selectedDay, selectedMonth, selectedYear]
  );

  const festivalOutlook = useMemo(() => {
    const selectedYearNumber = Number(festivalSelectedYear) || new Date().getFullYear();
    const festivalCalendar = extractFestivalCalendarFromAnalysis(historySourcePayload || analysisPayload || {}, selectedYearNumber);
    if (!festivalCalendar.length) {
      return {
        festivals: [],
        baselineDaily: 0,
        nextFestival: null,
        topImpactFestival: null,
      };
    }
    const historicalRows = pastDailyData
      .map((row) => {
        const parsedDate = parseLooseDate(row?.period);
        return {
          parsedDate,
          actual: Number(row?.actual || 0),
        };
      })
      .filter((row) => row.parsedDate && Number.isFinite(row.actual) && row.actual > 0)
      .map((row) => ({
        date: toIsoDay(row.parsedDate),
        actual: row.actual,
      }));
    const forecastRowsForYear = forecastRawData
      .map((row) => {
        const parsedDate = parseLooseDate(row?.period);
        return {
          parsedDate,
          predicted: Number(row?.predicted || 0),
        };
      })
      .filter((row) => row.parsedDate && row.parsedDate.getFullYear() === selectedYearNumber)
      .map((row) => ({
        date: toIsoDay(row.parsedDate),
        predicted: row.predicted,
      }))
      .filter((row) => row.date && Number.isFinite(row.predicted));

    const baselineDaily = forecastRowsForYear.length
      ? (forecastRowsForYear.reduce((sum, row) => sum + row.predicted, 0) / forecastRowsForYear.length)
      : Number(forecastStats.avgForecast || 0);

    const forecastByDate = new Map(forecastRowsForYear.map((row) => [row.date, row.predicted]));
    const actualByDate = new Map(historicalRows.map((row) => [row.date, row.actual]));

    const daysInWindow = 3;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const annotatedFestivals = festivalCalendar.map((festival) => {
      const center = parseLooseDate(festival.date);
      if (!center) {
        return {
          ...festival,
          projectedWindowSales: null,
          expectedDailySales: null,
          impactPct: null,
          impactDirection: 'flat',
          confidence: 'Low',
          predictionBacked: false,
          isUpcoming: false,
          daysUntil: null,
          isToday: false,
          isWithin45Days: false,
        };
      }
      const centerDay = new Date(center);
      centerDay.setHours(0, 0, 0, 0);
      const dayDiff = Math.round((centerDay.getTime() - today.getTime()) / 86400000);
      const isToday = dayDiff === 0;
      const isUpcoming = dayDiff >= 0;
      const isWithin45Days = isUpcoming && dayDiff <= 45;

      let windowSum = 0;
      let predictedPoints = 0;
      let actualWindowSum = 0;
      let actualPoints = 0;

      const previousYearCenter = new Date(center);
      previousYearCenter.setFullYear(center.getFullYear() - 1);
      let previousYearWindowSum = 0;
      let previousYearPoints = 0;

      for (let offset = -daysInWindow; offset <= daysInWindow; offset += 1) {
        const probe = new Date(center);
        probe.setDate(center.getDate() + offset);
        const key = toIsoDay(probe);
        const predicted = Number(forecastByDate.get(key) || 0);
        if (predicted > 0) {
          windowSum += predicted;
          predictedPoints += 1;
        }

        const actual = Number(actualByDate.get(key) || 0);
        if (actual > 0) {
          actualWindowSum += actual;
          actualPoints += 1;
        }

        const previousProbe = new Date(previousYearCenter);
        previousProbe.setDate(previousYearCenter.getDate() + offset);
        const previousKey = toIsoDay(previousProbe);
        const previousActual = Number(actualByDate.get(previousKey) || 0);
        if (previousActual > 0) {
          previousYearWindowSum += previousActual;
          previousYearPoints += 1;
        }
      }

      const projectedWindowSales = predictedPoints > 0 ? windowSum : null;
      const expectedDailySales = projectedWindowSales != null ? (projectedWindowSales / ((daysInWindow * 2) + 1)) : null;
      const impactPct = (expectedDailySales != null && baselineDaily > 0)
        ? ((expectedDailySales - baselineDaily) / baselineDaily) * 100
        : null;
      const impactDirection = impactPct == null ? 'flat' : (impactPct > 5 ? 'up' : (impactPct < -5 ? 'down' : 'flat'));
      const confidence = predictedPoints >= 4 ? 'High' : (predictedPoints >= 2 ? 'Medium' : 'Low');
      const actualWindowSales = actualPoints > 0
        ? actualWindowSum
        : (previousYearPoints > 0 ? previousYearWindowSum : 0);
      const actualSource = actualPoints > 0 ? 'Selected year' : (previousYearPoints > 0 ? 'Previous year analog' : 'No history');
      const varianceUnits = projectedWindowSales != null ? (projectedWindowSales - actualWindowSales) : null;
      const variancePct = (varianceUnits != null && actualWindowSales > 0) ? (varianceUnits / actualWindowSales) * 100 : null;

      return {
        ...festival,
        projectedWindowSales,
        expectedDailySales,
        impactPct,
        impactDirection,
        confidence,
        actualWindowSales,
        actualSource,
        varianceUnits,
        variancePct,
        predictionBacked: predictedPoints > 0,
        isUpcoming,
        daysUntil: dayDiff,
        isToday,
        isWithin45Days,
      };
    });

    const nextFestival = annotatedFestivals.find((festival) => festival.isUpcoming) || annotatedFestivals[0] || null;
    const topImpactFestival = [...annotatedFestivals]
      .filter((festival) => Number.isFinite(festival?.impactPct))
      .sort((a, b) => (b.impactPct - a.impactPct))[0] || null;

    return {
      festivals: annotatedFestivals,
      baselineDaily,
      nextFestival,
      topImpactFestival,
    };
  }, [festivalSelectedYear, forecastRawData, forecastStats.avgForecast, pastDailyData, historySourcePayload, analysisPayload]);

  const festivalYearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const maxFutureYear = currentYear + 2;
    const minYear = 2020;

    const yearsFromData = new Set();
    pastDailyData.forEach((row) => {
      const dt = parseLooseDate(row?.period);
      if (dt) yearsFromData.add(dt.getFullYear());
    });
    forecastRawData.forEach((row) => {
      const dt = parseLooseDate(row?.period);
      if (dt) yearsFromData.add(dt.getFullYear());
    });

    const derivedMin = yearsFromData.size ? Math.min(...Array.from(yearsFromData)) : currentYear;
    const startYear = Math.max(minYear, Math.min(derivedMin, currentYear));
    const result = [];
    for (let y = startYear; y <= maxFutureYear; y += 1) {
      result.push(String(y));
    }
    if (!result.includes(String(currentYear))) {
      result.push(String(currentYear));
      result.sort((a, b) => Number(a) - Number(b));
    }
    return result;
  }, [pastDailyData, forecastRawData]);

  const customerRowsSource = filteredHistoryRows;
  const festivalMonthsInYear = useMemo(() => {
    const monthMap = new Map();
    festivalOutlook.festivals.forEach((festival) => {
      const parsed = parseLooseDate(festival.date);
      if (!parsed) return;
      const key = String(parsed.getMonth() + 1).padStart(2, '0');
      if (!monthMap.has(key)) {
        monthMap.set(key, parsed.toLocaleDateString('en-US', { month: 'long' }));
      }
    });
    return Array.from(monthMap.entries()).map(([value, label]) => ({ value, label }));
  }, [festivalOutlook.festivals]);

  useEffect(() => {
    if (festivalViewMode !== 'month') return;
    if (festivalSelectedMonth !== 'all') return;
    if (!festivalMonthsInYear.length) return;
    setFestivalSelectedMonth(festivalMonthsInYear[0].value);
  }, [festivalViewMode, festivalSelectedMonth, festivalMonthsInYear]);

  useEffect(() => {
    if (!festivalYearOptions.length) return;
    if (festivalYearOptions.includes(festivalSelectedYear)) return;
    setFestivalSelectedYear(festivalYearOptions[festivalYearOptions.length - 1]);
  }, [festivalYearOptions, festivalSelectedYear]);

  useEffect(() => {
    setFestivalSelectedMonth('all');
    setFestivalSelectedKey('all');
  }, [festivalSelectedYear]);

  const filteredFestivalRows = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let rows = [...festivalOutlook.festivals];
    if (festivalTimelineFilter === 'past') {
      rows = rows.filter((festival) => {
        const dt = parseLooseDate(festival.date);
        if (!dt) return false;
        dt.setHours(0, 0, 0, 0);
        return dt.getTime() < today.getTime();
      });
    } else if (festivalTimelineFilter === 'upcoming') {
      rows = rows.filter((festival) => {
        const dt = parseLooseDate(festival.date);
        if (!dt) return false;
        dt.setHours(0, 0, 0, 0);
        return dt.getTime() >= today.getTime();
      });
    }

    if (festivalViewMode === 'month') {
      rows = rows.filter((festival) => {
        if (festivalSelectedMonth === 'all') return true;
        const dt = parseLooseDate(festival.date);
        if (!dt) return false;
        const monthKey = String(dt.getMonth() + 1).padStart(2, '0');
        return monthKey === festivalSelectedMonth;
      });
    }

    if (festivalViewMode === 'specific') {
      rows = rows.filter((festival) => festivalSelectedKey === 'all' || festival.key === festivalSelectedKey);
    }

    return rows.sort((a, b) => (parseLooseDate(a.date)?.getTime() || 0) - (parseLooseDate(b.date)?.getTime() || 0));
  }, [festivalOutlook.festivals, festivalTimelineFilter, festivalViewMode, festivalSelectedMonth, festivalSelectedKey]);

  useEffect(() => {
    if (!filteredFestivalRows.length) {
      setFestivalStockFocusKey('all');
      return;
    }
    const validKeys = new Set(filteredFestivalRows.map((f) => f.key));
    if (festivalStockFocusKey === 'all' || validKeys.has(festivalStockFocusKey)) return;
    setFestivalStockFocusKey(filteredFestivalRows[0].key);
  }, [filteredFestivalRows, festivalStockFocusKey]);

  const festivalComparisonChartData = useMemo(() => {
    return filteredFestivalRows
      .filter((festival) => Number(festival.actualWindowSales || 0) > 0 || Number(festival.projectedWindowSales || 0) > 0)
      .slice(0, 12)
      .map((festival) => ({
        name: festival.name.length > 11 ? `${festival.name.slice(0, 11)}...` : festival.name,
        fullName: festival.name,
        actual: Math.round(Number(festival.actualWindowSales || 0)),
        predicted: Math.round(Number(festival.projectedWindowSales || 0)),
      }));
  }, [filteredFestivalRows]);

  const festivalStockInsights = useMemo(() => {
    const festivals = festivalOutlook.festivals || [];
    const targetFestivals = festivals.filter((festival) => (
      festivalStockFocusKey === 'all' || festival.key === festivalStockFocusKey
    ));
    if (!targetFestivals.length) {
      return { focusedFestival: null, rows: [] };
    }

    const focusedFestival = targetFestivals[0];
    const centerDate = parseLooseDate(focusedFestival.date);
    if (!centerDate) {
      return { focusedFestival, rows: [] };
    }

    const windowDays = 3;
    const startDate = new Date(centerDate);
    const endDate = new Date(centerDate);
    startDate.setDate(centerDate.getDate() - windowDays);
    endDate.setDate(centerDate.getDate() + windowDays);

    const byStock = new Map();
    historyRows.forEach((row) => {
      const dt = parseLooseDate(row?.orderDate || row?.deliveryDate || row?.effectiveDate);
      if (!dt || dt < startDate || dt > endDate) return;
      const key = String(row?.stockName || 'Unknown Stock');
      if (!byStock.has(key)) {
        byStock.set(key, {
          stockName: key,
          pastSold: 0,
          futurePredicted: 0,
          varianceUnits: 0,
          discountSuggestion: 'No discount',
          discountPct: 0,
          actionSuggestion: 'Maintain standard inventory',
        });
      }
      const item = byStock.get(key);
      item.pastSold += Number(row?.quantity || 0);
    });

    forecasts.forEach((product) => {
      const stockName = String(product?.name || product?.sku || 'Unknown Stock');
      if (!byStock.has(stockName)) {
        byStock.set(stockName, {
          stockName,
          pastSold: 0,
          futurePredicted: 0,
          varianceUnits: 0,
          discountSuggestion: 'No discount',
          discountPct: 0,
          actionSuggestion: 'Maintain standard inventory',
        });
      }

      const item = byStock.get(stockName);
      const datedForecast = (product.weeks || []).reduce((sum, week) => {
        const weekDate = parseLooseDate(week?.date);
        if (!weekDate) return sum;
        if (weekDate >= startDate && weekDate <= endDate) {
          return sum + Number(week?.demand || 0);
        }
        return sum;
      }, 0);

      if (datedForecast > 0) item.futurePredicted += datedForecast;
    });

    const rows = Array.from(byStock.values())
      .map((row) => {
        const past = Math.round(row.pastSold || 0);
        const predicted = Math.round(row.futurePredicted || 0);
        const varianceUnits = predicted - past;
        const variancePct = past > 0 ? ((varianceUnits / past) * 100) : 0;
        let discountPct = 0;
        let actionSuggestion = 'Maintain standard inventory';
        if (variancePct >= 25) {
          discountPct = 0;
          actionSuggestion = 'Increase stock 20-30% and prioritize fast-moving SKUs';
        } else if (variancePct >= 8) {
          discountPct = 5;
          actionSuggestion = 'Add light promo and increase stock 10-15%';
        } else if (variancePct <= -20) {
          discountPct = 18;
          actionSuggestion = 'Strong markdown and reduce procurement for this festival';
        } else if (variancePct <= -8) {
          discountPct = 10;
          actionSuggestion = 'Use bundle offers and keep conservative stock';
        } else {
          discountPct = 5;
          actionSuggestion = 'Run controlled offer and keep balanced stock';
        }

        return {
          stockName: row.stockName,
          pastSold: past,
          futurePredicted: predicted,
          varianceUnits,
          variancePct,
          discountPct,
          discountSuggestion: discountPct > 0 ? `${discountPct}% festival offer` : 'No discount',
          actionSuggestion,
        };
      })
      .filter((row) => row.pastSold > 0 || row.futurePredicted > 0)
      .sort((a, b) => (b.futurePredicted - a.futurePredicted) || (b.pastSold - a.pastSold))
      .slice(0, 25);

    return { focusedFestival, rows };
  }, [festivalOutlook.festivals, festivalStockFocusKey, historyRows, forecasts]);

  const topHistoryCustomers = useMemo(() => {
    const byCustomer = new Map();
    customerRowsSource.forEach((row) => {
      const key = row.customerId || row.customerName;
      if (!key) return;
      if (!byCustomer.has(key)) {
        byCustomer.set(key, {
          customerName: row.customerName,
          customerId: row.customerId,
          orders: 0,
          quantity: 0,
          totalAmount: 0,
          pendingAmount: 0,
          latestOrderDate: row.orderDate || row.deliveryDate || null,
        });
      }
      const entry = byCustomer.get(key);
      entry.orders += 1;
      entry.quantity += Number(row.quantity || 0);
      entry.totalAmount += Number(row.totalAmount || 0);
      entry.pendingAmount += Number(row.pendingAmount || 0);
      entry.latestOrderDate = entry.latestOrderDate || row.orderDate || row.deliveryDate || null;
    });

    return Array.from(byCustomer.values())
      .filter((entry) => Number(entry.totalAmount || 0) > 0 || Number(entry.quantity || 0) > 0)
      .sort((a, b) => (b.totalAmount - a.totalAmount) || (b.quantity - a.quantity))
      .slice(0, 100);
  }, [customerRowsSource]);

  const topCustomerLeaderboard = useMemo(() => {
    if (topHistoryCustomers.length > 0) return topHistoryCustomers;
    return buildCustomerLeaderboardFromAnalysis(analysisPayload || {});
  }, [topHistoryCustomers, analysisPayload]);

  const visibleCustomerLimit = customerLeaderboardView === 'top5'
    ? 5
    : customerLeaderboardView === 'top20'
      ? 20
      : topCustomerLeaderboard.length;

  const visibleHistoryCustomers = useMemo(
    () => topCustomerLeaderboard.slice(0, visibleCustomerLimit),
    [topCustomerLeaderboard, visibleCustomerLimit]
  );

  const analysisProducts = useMemo(
    () => getAnalysisProducts(analysisPayload || {}),
    [analysisPayload]
  );

  const currentStockTotal = useMemo(() => {
    const fromForecastProducts = sumCurrentStockFromProducts(forecasts || []);
    if (fromForecastProducts > 0) return fromForecastProducts;

    const fromAnalysisProducts = sumCurrentStockFromProducts(analysisProducts || []);
    if (fromAnalysisProducts > 0) return fromAnalysisProducts;

    const summaryStock = toSafeNumber(
      analysisPayload?.inventory_summary?.total_current_stock
      ?? analysisPayload?.inventory_summary?.current_stock
      ?? analysisPayload?.summary?.total_current_stock
      ?? analysisPayload?.summary?.current_stock
      ?? analysisPayload?.summary?.total_stock
    );
    return Number.isFinite(summaryStock) ? summaryStock : 0;
  }, [forecasts, analysisProducts, analysisPayload]);

  const customerCountForCards = useMemo(() => {
    if (globalHistorySummary.customerCount > 0) return globalHistorySummary.customerCount;

    const customersFromAnalysis = Array.isArray(analysisPayload?.customers) ? analysisPayload.customers.length : 0;
    if (customersFromAnalysis > 0) return customersFromAnalysis;

    return topCustomerLeaderboard.length;
  }, [globalHistorySummary.customerCount, analysisPayload, topCustomerLeaderboard]);

  const stockCountForCards = useMemo(() => {
    if (globalHistorySummary.stockCount > 0) return globalHistorySummary.stockCount;
    return analysisProducts.length;
  }, [globalHistorySummary.stockCount, analysisProducts]);

  const scopedSelectionMetrics = useMemo(() => {
    const scopedCustomers = new Set(scopedHistoryRows.map((r) => r.customerId || r.customerName).filter(Boolean)).size;
    const scopedItems = new Set(scopedHistoryRows.map((r) => r.stockName).filter(Boolean)).size;
    const pastSales = scopedHistoryRows.reduce((sum, row) => sum + Number(row?.quantity || 0), 0);
    const scopedRevenue = scopedHistoryRows.reduce((sum, row) => sum + Number(row?.totalAmount || 0), 0);
    const futureSales = scopedForecastRows.reduce((sum, row) => sum + Number(row?.predicted || 0), 0);
    const historicalRevenueBaseline = historySummary.totalAmount > 0
      ? historySummary.totalAmount
      : globalHistorySummary.totalAmount;
    const revenue = forecastMode === 'future'
      ? historicalRevenueBaseline
      : scopedRevenue;

    return {
      customers: scopedCustomers > 0 ? scopedCustomers : customerCountForCards,
      items: scopedItems > 0 ? scopedItems : stockCountForCards,
      orders: scopedHistoryRows.length,
      sales: forecastMode === 'past' ? pastSales : (forecastMode === 'future' ? futureSales : (pastSales + futureSales)),
      revenue,
      aiPredicted: futureSales,
      forecastPoints: scopedForecastRows.length,
      historicalRevenueBaseline,
    };
  }, [
    scopedHistoryRows,
    scopedForecastRows,
    forecastMode,
    customerCountForCards,
    stockCountForCards,
    historySummary.totalAmount,
    globalHistorySummary.totalAmount,
  ]);

  const selectionLabel = useMemo(() => {
    if (timeGranularity === 'day') return selectedDay;
    if (timeGranularity === 'month') return selectedMonth;
    return selectedYear;
  }, [timeGranularity, selectedDay, selectedMonth, selectedYear]);

  const exportSelectedWindowCsv = () => {
    const rowsMap = new Map();

    displayPastData.forEach((row) => {
      const key = String(row?.period || '');
      if (!key) return;
      rowsMap.set(key, {
        period: key,
        actual: Number(row?.actual || 0),
        predicted: '',
        lower: '',
        upper: '',
      });
    });

    displayForecastData.forEach((row) => {
      const key = String(row?.period || '');
      if (!key) return;
      const existing = rowsMap.get(key) || {
        period: key,
        actual: '',
        predicted: '',
        lower: '',
        upper: '',
      };
      rowsMap.set(key, {
        ...existing,
        predicted: Number(row?.predicted || 0),
        lower: row?.lower != null ? Number(row.lower) : '',
        upper: row?.upper != null ? Number(row.upper) : '',
      });
    });

    const rows = Array.from(rowsMap.values());
    if (!rows.length) return;

    const header = ['period', 'actual', 'predicted', 'lower', 'upper'];
    const csv = [
      header.join(','),
      ...rows.map((row) => header.map((key) => row[key] ?? '').join(',')),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `forecast-window-${timeGranularity}-${selectionLabel}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const allTrends = useMemo(() => {
    if (!forecasts.length) return [];
    return forecasts.map((item) => {
      const total = (item.weeks || []).reduce((sum, w) => sum + Number(w.demand || 0), 0);
      return { name: String(item.name || item.sku || 'Item'), value: total };
    }).sort((a, b) => b.value - a.value);
  }, [forecasts]);

  const trendData = useMemo(() => {
    const palette = ['#10b981', '#059669', '#34d399', '#6ee7b7', '#a7f3d0'];
    return allTrends.slice(0, 5).map((entry, index) => ({
      name: entry.name.length > 12 ? `${entry.name.slice(0, 11)}...` : entry.name,
      fullName: entry.name,
      value: entry.value,
      color: palette[index % palette.length],
    }));
  }, [allTrends]);

  const trendSummary = useMemo(() => {
    const totalUnits = allTrends.reduce((sum, item) => sum + Number(item.value || 0), 0);
    const forecastWindows = forecasts
      .map((item) => (item.weeks || []).length)
      .filter((len) => Number.isFinite(len) && len > 0);
    const windowSize = forecastWindows.length ? Math.max(...forecastWindows) : 4;
    const avgUnitsPerWindow = totalUnits / Math.max(1, windowSize);
    return {
      totalUnits,
      avgUnitsPerWindow,
      windowSize,
      topProduct: allTrends[0]?.name || 'Not available',
    };
  }, [allTrends, forecasts]);

  const formatUnits = (value) => {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric)) return '0';
    return new Intl.NumberFormat('en-US').format(Math.round(numeric));
  };

  const summaryMetricCards = useMemo(() => ([
    {
      label: 'Customers',
      value: scopedSelectionMetrics.customers,
      hint: `Across ${scopedSelectionMetrics.items} items`,
      icon: Users,
      tone: 'from-sky-500 to-blue-600',
    },
    {
      label: 'Total Sales',
      value: formatUnits(scopedSelectionMetrics.sales),
      hint: forecastMode === 'future'
        ? `${scopedSelectionMetrics.forecastPoints} forecast points`
        : `From ${scopedSelectionMetrics.orders} orders`,
      icon: Box,
      tone: 'from-violet-500 to-purple-600',
    },
    {
      label: 'Revenue',
      value: formatCompactCurrency(scopedSelectionMetrics.revenue),
      hint: forecastMode === 'future'
        ? 'Historical billed value baseline'
        : 'Selected window billed value',
      icon: CircleDollarSign,
      tone: 'from-emerald-500 to-teal-600',
    },
    {
      label: 'Current Stock',
      value: formatUnits(currentStockTotal),
      hint: 'Units in hand',
      icon: ShieldCheck,
      tone: 'from-blue-600 to-indigo-700',
    },
    {
      label: 'AI Predicted',
      value: formatUnits(scopedSelectionMetrics.aiPredicted),
      hint: forecastMode === 'future'
        ? 'Total predicted units'
        : 'Forecast in selected window',
      icon: TrendingUp,
      tone: 'from-emerald-600 to-teal-700',
    },
  ]), [scopedSelectionMetrics, forecastMode, currentStockTotal]);



  useEffect(() => { fetchInitialData(); }, [selectedUploadId, liveAnalysis]);

  useEffect(() => {
    const latestUploadId = Number(latestMeta?.uploadId || 0);
    if (selectedUploadId) return;
    if (!Number.isFinite(latestUploadId) || latestUploadId <= 0) return;
    if (autoPinnedUploadRef.current === latestUploadId) return;
    autoPinnedUploadRef.current = latestUploadId;
    pinUploadAnalysis(latestUploadId);
  }, [selectedUploadId, latestMeta?.uploadId, pinUploadAnalysis]);

  const fetchInitialData = async () => {
    try {
      const contextPayload = extractAnalysisPayload(liveAnalysis);
      const hasContextData = hasUsableForecastPayload(contextPayload);
      if (!hasContextData) {
        setLoading(true);
      }

      let analysisPayload = null;
      let sourcePayload = null;

      if (hasContextData) {
        analysisPayload = contextPayload;
        sourcePayload = liveAnalysis;
        applyAnalysisPayload(analysisPayload, sourcePayload);
        setLoading(false);
      }

      // 1) Highest authority: explicitly selected upload from backend DB
      if (selectedUploadId) {
        try {
          const { data } = await api.get(`/ingestion/upload-analysis/${selectedUploadId}/`);
          sourcePayload = data;
          analysisPayload = extractAnalysisPayload(data);
        } catch {
          analysisPayload = null;
          sourcePayload = null;
        }
      }

      // Strict upload-driven mode:
      // If upload-specific payload is unavailable, use in-memory analysis only.
      // Do not fall back to generic latest-analysis (can belong to another sheet).
      if (!analysisPayload) {
        analysisPayload = contextPayload;
        sourcePayload = liveAnalysis;
      }

      if (analysisPayload) {
        applyAnalysisPayload(analysisPayload, sourcePayload || analysisPayload);
        return;
      }

      setPastDailyData([]);
      setPastWeeklyData([]);
      setForecastRawData([]);
      setForecasts([]);
      setHistorySourcePayload(sourcePayload || liveAnalysis || null);
      setForecastQuality({
        signalReady: false,
        source: 'none',
        qualityScore: 0,
        dateCoverage: 0,
        signalRatio: 0,
      });
      setAuditData({ aggregate_accuracy: 0, stability: 'Waiting for analysis', recommendation: '' });
    } catch (err) {
      console.error('Failed to fetch forecasts:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-32 gap-6 bg-[var(--bg-accent)] rounded-3xl">
        <div className="w-16 h-16 border-4 border-emerald-500/10 border-t-emerald-500 rounded-full animate-spin" />
        <p className="text-xs font-bold tracking-widest text-emerald-500 uppercase">Loading forecasts...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-20">


      {/* ── Main Card ── */}
      <GlassCard className="!p-0 !border-slate-200/60 dark:!border-white/10 !bg-white dark:!bg-slate-900/40 overflow-visible shadow-xl">


        {/* ── AI Engine status bar ── */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
          <div className="w-7 h-7 rounded-xl bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center">
            <Activity size={14} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="flex-1">
            <span className="text-[12px] font-semibold text-slate-700">
              AI Analysis Active
            </span>
            <span className="text-[11px] text-slate-500 ml-2">
              Live insights from your sales data
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-semibold text-emerald-600">Live</span>
          </div>
          {festivalOutlook.nextFestival && (
            <div className="ml-2 inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              <span className="text-[10px] font-black uppercase tracking-[0.12em] text-amber-700">
                {festivalOutlook.nextFestival.name}
              </span>
            </div>
          )}
        </div>

        {!forecastQuality.signalReady && (
          <div className="mx-6 mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-[11px] font-black uppercase tracking-[0.15em] text-amber-700">Forecast Quality Warning</p>
            <p className="mt-1 text-sm font-semibold text-amber-800">
              Clean sales signal low hai, isliye forecast ko estimate samjho, exact number nahi.
            </p>
            <p className="mt-1 text-xs text-amber-700">
              Source: {forecastQuality.source} | Quality: {Math.round(forecastQuality.qualityScore)} | Date coverage: {Math.round(forecastQuality.dateCoverage * 100)}% | Signal ratio: {Math.round(forecastQuality.signalRatio * 100)}%
            </p>
          </div>
        )}

        {/* ── Chart Section ── */}
        <div className="px-6 pt-6 pb-3">
          <div className="mb-4">
            <div>
              <h3 className="text-[20px] font-semibold text-slate-900 dark:text-white leading-none mb-1">
                Demand Insights
              </h3>
              <p className="text-[13px] text-slate-500 dark:text-slate-400">
                Sales history & predictions
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-slate-200 bg-slate-50/60 p-2.5 mb-4 px-6 mx-6">
            <div className="inline-flex items-center rounded-xl border border-slate-200 bg-white p-1">
              <button
                onClick={() => setForecastMode('past')}
                className={`px-3.5 py-2 rounded-lg text-[12px] font-medium transition-all duration-200 ${forecastMode === 'past' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                Past
              </button>
              <button
                onClick={() => setForecastMode('future')}
                className={`px-3.5 py-2 rounded-lg text-[12px] font-medium transition-all duration-200 ${forecastMode === 'future' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                Future
              </button>
              <button
                onClick={() => setForecastMode('combined')}
                className={`px-3.5 py-2 rounded-lg text-[12px] font-medium transition-all duration-200 ${forecastMode === 'combined' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                Combined
              </button>
            </div>
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white p-1"
            >
              {['day', 'month', 'year'].map((option) => (
                <button
                  key={option}
                  onClick={() => setTimeGranularity(option)}
                  className={`px-3 py-2 rounded-lg text-[12px] font-medium transition-all duration-200 ${timeGranularity === option ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  {option}
                </button>
              ))}
            </motion.div>
            <div className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-2 py-1.5">
              {timeGranularity === 'day' && (
                <input
                  type="date"
                  value={selectedDay}
                  onChange={(e) => setSelectedDay(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-700 focus:border-slate-400 focus:outline-none"
                />
              )}
              {timeGranularity === 'month' && (
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-700 focus:border-slate-400 focus:outline-none"
                />
              )}
              {timeGranularity === 'year' && (
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] text-slate-700 focus:border-slate-400 focus:outline-none"
                >
                  {availableYears.map((yearValue) => (
                    <option key={yearValue} value={String(yearValue)}>
                      {yearValue}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="ml-auto inline-flex items-center gap-2">
              <div className="inline-flex items-center rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
                <button
                  type="button"
                  title="Chart view"
                  aria-label="Chart view"
                  onClick={() => setForecastViewMode('chart')}
                  className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors ${forecastViewMode === 'chart' ? 'border-slate-900 bg-slate-900 text-white' : 'border-transparent text-slate-600 hover:bg-slate-100'}`}
                >
                  <BarChart3 size={14} />
                  <span>Chart</span>
                </button>
                <button
                  type="button"
                  title="Table view"
                  aria-label="Table view"
                  onClick={() => setForecastViewMode('table')}
                  className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors ${forecastViewMode === 'table' ? 'border-slate-900 bg-slate-900 text-white' : 'border-transparent text-slate-600 hover:bg-slate-100'}`}
                >
                  <List size={14} />
                  <span>Table</span>
                </button>
              </div>
              <button
                onClick={() => {
                  setShowAllTrends(false);
                  setShowTrends(true);
                }}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-slate-700 hover:bg-slate-100"
              >
                <TrendingUp size={14} />
                Trends
              </button>
              <button
                onClick={() => setShowFestivalPopup(true)}
                className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-800 hover:bg-amber-100"
              >
                <Calendar size={14} />
                Festival
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            {summaryMetricCards.map((card) => {
              const Icon = card.icon;
              return (
                <motion.div
                  key={`scoped-${card.label}`}
                  whileHover={{ y: -2, scale: 1.01 }}
                  className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm transition-all hover:shadow-md"
                >
                  <div className={`absolute top-0 right-0 h-16 w-16 -mr-6 -mt-6 rounded-full bg-gradient-to-br ${card.tone} opacity-[0.05]`} />
                  <div className="relative z-10 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">{card.label}</p>
                      <h4 className="mt-1 text-3xl font-black text-slate-900 tracking-tight">{card.value}</h4>
                      <p className="mt-1 text-[11px] font-bold text-slate-500">{card.hint}</p>
                    </div>
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${card.tone} text-white shadow`}>
                      <Icon size={18} strokeWidth={2.5} />
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>

          <div className="mt-5 grid grid-cols-1 gap-6">
            {forecastViewMode === 'chart' ? (
              <PredictionChart
                pastData={displayPastData}
                forecastData={displayForecastData}
                mode={forecastMode}
                horizon={timeGranularity}
                isAnalyzing={loading}
              />
            ) : (
              <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-5 py-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Detailed Ledger</p>
                    <h4 className="mt-1 text-lg font-black text-slate-900">Who bought what, when, and payment status</h4>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600">
                    <Truck size={14} className="text-emerald-500" />
                    Delivery + payment timeline
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-full border-separate border-spacing-0">
                    <thead className="bg-slate-50/80">
                      <tr>
                        {['Customer', 'Stock', 'Qty', 'Order Value', 'Paid', 'Pending', 'Order Date', 'Delivery', 'Payment'].map((label) => {
                          const isNumeric = ['Qty', 'Order Value', 'Paid', 'Pending'].includes(label);
                          return (
                            <th
                              key={label}
                              className={`px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 whitespace-nowrap border-r border-b border-slate-200/60 last:border-r-0 ${isNumeric ? 'text-right' : 'text-left'}`}
                            >
                              {label}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {tableRowsToRender.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="px-4 py-12 text-center">
                            <div className="mx-auto max-w-md">
                              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-600">
                                <ShieldCheck size={26} />
                              </div>
                              <p className="mt-4 text-base font-black text-slate-900">No past result rows for selected filter</p>
                              <p className="mt-2 text-sm text-slate-500">
                                Agar uploaded sheet mein customer, product, quantity, order/delivery ya payment columns honge to yeh section automatically populate ho jayega.
                              </p>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        tableRowsToRender.map((row) => {
                          const paymentTone = row.paymentStatus === 'Paid'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : (row.paymentStatus === 'Partial'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : (row.paymentStatus === 'Projected' || row.paymentStatus === 'Mixed')
                                ? 'bg-sky-50 text-sky-700 border-sky-200'
                                : 'bg-rose-50 text-rose-700 border-rose-200');

                          return (
                            <tr key={row.id} className="align-top hover:bg-slate-50/80 transition-colors">
                              <td className="px-6 py-5 border-r border-b border-slate-100 last:border-r-0">
                                <p className="text-sm font-bold text-slate-900">{row.customerName}</p>
                                {row.customerId && row.customerId !== row.customerName && (
                                  <p className="mt-1 text-[10px] font-medium text-slate-400 tracking-wide">{row.customerId}</p>
                                )}
                              </td>
                              <td className="px-6 py-5 border-r border-b border-slate-100 last:border-r-0">
                                <p className="text-sm font-medium text-slate-700 leading-snug">{row.stockName}</p>
                              </td>
                              <td className="px-6 py-5 text-right text-sm font-bold text-slate-900 tabular-nums border-r border-b border-slate-100 last:border-r-0">{formatUnits(row.quantity)}</td>
                              <td className="px-6 py-5 text-right text-sm font-bold text-slate-900 tabular-nums border-r border-b border-slate-100 last:border-r-0">{formatCurrency(row.totalAmount || 0)}</td>
                              <td className="px-6 py-5 text-right text-sm font-bold text-emerald-600 tabular-nums border-r border-b border-slate-100 last:border-r-0">{formatCurrency(row.paidAmount || 0)}</td>
                              <td className="px-6 py-5 text-right text-sm font-bold text-amber-600 tabular-nums border-r border-b border-slate-100 last:border-r-0">{formatCurrency(row.pendingAmount || 0)}</td>
                              <td className="px-6 py-5 border-r border-b border-slate-100 last:border-r-0">
                                <p className="text-sm font-medium text-slate-800">{formatFriendlyDate(row.orderDate)}</p>
                              </td>
                              <td className="px-6 py-5 border-r border-b border-slate-100 last:border-r-0">
                                <p className="text-sm font-medium text-slate-800">{formatFriendlyDate(row.deliveryDate)}</p>
                                <p className="mt-1 text-[10px] font-medium text-slate-400 tracking-wide">{formatDeliveryDelta(row.orderDate, row.deliveryDate)}</p>
                              </td>
                              <td className="px-6 py-5 border-b border-slate-100 last:border-r-0">
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${paymentTone}`}>
                                  <span className={`w-1 h-1 rounded-full mr-1.5 ${row.paymentStatus === 'Paid' ? 'bg-emerald-500' : (row.paymentStatus === 'Partial' ? 'bg-amber-500' : ((row.paymentStatus === 'Projected' || row.paymentStatus === 'Mixed') ? 'bg-sky-500' : 'bg-rose-500'))}`} />
                                  {row.paymentStatus}
                                </span>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

        {/* ── Business Distribution Charts ── */}
        <div className="border-t border-slate-100 bg-slate-50/30 px-6 py-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Business Distribution</p>
              <h4 className="mt-1 text-lg font-black text-slate-900">
                {forecastViewMode === 'chart' ? 'Top Products & Customers' : 'Top Entities Ledger'}
              </h4>
            </div>
          </div>
          
          <div className="grid grid-cols-1 gap-6">
            

            {/* Customer Horizontal Bar Chart */}
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md min-h-[420px]">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600">
                    <Users size={18} />
                  </div>
                  <div>
                    <h5 className="text-sm font-bold text-slate-900">Revenue by Customer</h5>
                    <p className="text-[11px] font-medium text-slate-500">
                      {customerLeaderboardView === 'top5'
                        ? 'Top 5 clients'
                        : customerLeaderboardView === 'top20'
                          ? 'Top 20 clients'
                          : `All ${topCustomerLeaderboard.length} clients`}
                    </p>
                  </div>
                </div>

                <div className="inline-flex items-center rounded-2xl border border-slate-200 bg-slate-50 p-1 shadow-sm">
                  {[
                    { key: 'top5', label: 'Top 5' },
                    { key: 'top20', label: 'Top 20' },
                    { key: 'all', label: 'All' },
                  ].map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setCustomerLeaderboardView(option.key)}
                      className={`rounded-xl px-3 py-2 text-[11px] font-bold transition-all ${
                        customerLeaderboardView === option.key
                          ? 'bg-slate-900 text-white shadow-sm'
                          : 'text-slate-600 hover:bg-white'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              
              {topCustomerLeaderboard.length === 0 ? (
                <div className="flex min-h-[320px] items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50/70 px-6 text-center">
                  <div>
                    <p className="text-sm font-bold text-slate-800">Customer revenue data not available</p>
                    <p className="mt-1 text-xs font-medium text-slate-500">
                      Customer-wise billed history milte hi yahan ranked breakdown automatically dikhega.
                    </p>
                  </div>
                </div>
              ) : forecastViewMode === 'chart' ? (
                <div className="h-[320px] min-h-[320px]">
                  <ResponsiveContainer width="100%" height="100%" minWidth={320} minHeight={320}>
                    <BarChart
                      data={visibleHistoryCustomers}
                      layout="vertical"
                      margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="customerGradient" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.8} />
                          <stop offset="100%" stopColor="#0ea5e9" stopOpacity={1} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 4" horizontal={true} vertical={false} stroke="#e2e8f0" opacity={0.5} />
                      <XAxis type="number" hide />
                      <YAxis 
                        type="category" 
                        dataKey="customerName" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: '#64748b', fontSize: 11, fontWeight: 600 }} 
                        width={90}
                        tickFormatter={(val) => val.length > 10 ? `${val.substring(0,9)}...` : val}
                      />
                      <Tooltip
                        cursor={{ fill: '#f8fafc' }}
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            return (
                              <div className="rounded-2xl border border-white/40 bg-white/90 backdrop-blur-xl px-4 py-3 shadow-xl">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">{data.customerName}</p>
                                <div className="space-y-1">
                                  <p className="text-xs font-semibold text-slate-600 flex justify-between gap-4">
                                    <span>Revenue:</span>
                                    <span className="font-black text-sky-600">{formatCompactCurrency(data.totalAmount)}</span>
                                  </p>
                                  <p className="text-xs font-semibold text-slate-600 flex justify-between gap-4">
                                    <span>Orders:</span>
                                    <span className="font-bold text-slate-900">{data.orders}</span>
                                  </p>
                                  <p className="text-xs font-semibold text-slate-600 flex justify-between gap-4">
                                    <span>Units:</span>
                                    <span className="font-bold text-slate-900">{formatUnits(data.quantity)}</span>
                                  </p>
                                </div>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Bar 
                        dataKey="totalAmount" 
                        fill="url(#customerGradient)" 
                        radius={[0, 8, 8, 0]} 
                        barSize={20}
                        animationDuration={1500}
                      >
                        <LabelList 
                          dataKey="totalAmount" 
                          position="right" 
                          formatter={(val) => formatCompactCurrency(val)}
                          style={{ fill: '#334155', fontSize: 10, fontWeight: 700 }}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[320px] min-h-[320px] overflow-y-auto custom-scrollbar pr-2">
                  <table className="w-full border-separate border-spacing-0">
                    <thead className="bg-slate-50/80 sticky top-0 z-10">
                      <tr>
                        <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100 rounded-tl-xl">Client</th>
                        <th className="px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">Orders</th>
                        <th className="px-4 py-3 text-right text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100 rounded-tr-xl">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleHistoryCustomers.map((cust, idx) => (
                        <tr key={idx} className="hover:bg-sky-50/30 transition-colors group">
                          <td className="px-4 py-3 border-b border-slate-50">
                            <div className="flex items-center gap-3">
                              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-100 text-[10px] font-black text-sky-600 shadow-sm border border-sky-200">
                                {idx + 1}
                              </div>
                              <p className="text-sm font-bold text-slate-800 truncate max-w-[150px] group-hover:text-sky-600 transition-colors">{cust.customerName}</p>
                            </div>
                          </td>
                          <td className="px-4 py-3 border-b border-slate-50 text-center">
                            <span className="inline-flex items-center justify-center min-w-[2rem] h-6 rounded-full bg-slate-100 text-[11px] font-bold text-slate-600 border border-slate-200">
                              {cust.orders}
                            </span>
                          </td>
                          <td className="px-4 py-3 border-b border-slate-50 text-right">
                            <p className="text-sm font-black text-slate-900 tabular-nums">{formatCompactCurrency(cust.totalAmount)}</p>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>

      </GlassCard>
      {/* â”€â”€ Trends Modal â”€â”€ */}
      <AnimatePresence>
        {showTrends && (
          <motion.div
            key="trends-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 backdrop-blur-sm px-2 sm:px-4 lg:px-6"
            onClick={() => setShowTrends(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="relative h-[94vh] w-[min(97vw,1520px)] max-h-[94vh] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.24)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="border-b border-slate-200 bg-gradient-to-br from-slate-50 via-white to-emerald-50/40 px-5 py-5 sm:px-8 sm:py-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 shadow-sm shadow-emerald-500/5">
                      <BarChart3 size={22} />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-2xl font-black tracking-tight text-slate-900 leading-tight">Top Trending Products</h4>
                      <p className="text-[11px] font-bold tracking-[0.1em] uppercase text-slate-500 mt-1.5 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Next {trendSummary.windowSize} weeks projection
                      </p>
                    </div>
                  </div>
                  <div className="ml-auto flex items-center gap-3">
                    <div className="inline-flex items-center rounded-2xl p-1 bg-white border border-slate-200 shadow-sm">
                      <button
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 ${!showAllTrends ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}
                        onClick={() => setShowAllTrends(false)}
                      >
                        <BarChart3 size={14} />
                        Chart
                      </button>

                      <button
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 ${showAllTrends ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}
                        onClick={() => setShowAllTrends(true)}
                      >
                        <List size={14} />
                        Ranked Table
                      </button>
                    </div>
                    <button
                      className="p-2.5 rounded-2xl border border-slate-200 bg-white text-slate-500 hover:text-slate-900 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm"
                      onClick={() => setShowTrends(false)}
                      aria-label="Close trends"
                    >
                      <X size={18} />
                    </button>
                  </div>
                </div>

                {/* ── Trend Analysis Control Bar ── */}
                <div className="mt-8 flex flex-wrap items-stretch gap-4">
                  <div className="flex grow items-center gap-2 rounded-[2rem] border border-slate-200 bg-slate-50/50 p-1.5 shadow-sm transition-all focus-within:border-emerald-500/50 focus-within:ring-4 focus-within:ring-emerald-500/10 sm:p-2">
                    <div className="flex items-center gap-1 rounded-2xl bg-white p-1 shadow-sm border border-slate-100">
                      {['day', 'month', 'year'].map((option) => (
                        <button
                          key={option}
                          onClick={() => setTrendTimeGranularity(option)}
                          className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-[0.15em] transition-all duration-300 ${trendTimeGranularity === option ? 'bg-slate-900 text-white shadow-lg shadow-slate-900/20' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                    <div className="h-8 w-[1px] bg-slate-200/60 mx-1 hidden sm:block" />
                    <div className="flex grow items-center gap-3 px-3">
                      <Search size={18} className="text-slate-400" />
                      <div className="flex grow items-center gap-2">
                        {trendTimeGranularity === 'day' && (
                          <input
                            type="date"
                            value={trendSelectedDay}
                            onChange={(e) => setTrendSelectedDay(e.target.value)}
                            className="w-full border-0 bg-transparent py-2 text-sm font-bold text-slate-700 placeholder:text-slate-400 focus:outline-none"
                          />
                        )}
                        {trendTimeGranularity === 'month' && (
                          <input
                            type="month"
                            value={trendSelectedMonth}
                            onChange={(e) => setTrendSelectedMonth(e.target.value)}
                            className="w-full border-0 bg-transparent py-2 text-sm font-bold text-slate-700 placeholder:text-slate-400 focus:outline-none"
                          />
                        )}
                        {trendTimeGranularity === 'year' && (
                          <select
                            value={trendSelectedYear}
                            onChange={(e) => setTrendSelectedYear(e.target.value)}
                            className="w-full border-0 bg-transparent py-2 text-sm font-bold text-slate-700 focus:outline-none cursor-pointer appearance-none"
                          >
                            {availableTrendYears.map((yearValue) => (
                              <option key={yearValue} value={String(yearValue)}>{yearValue}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 rounded-[2rem] border border-slate-200 bg-white px-6 py-2 shadow-sm">
                    <div className="text-right">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Volume</p>
                      <p className="text-sm font-black text-slate-900 tabular-nums">{formatUnits(trendSalesTotal)} <span className="text-[10px] text-slate-400 font-bold uppercase ml-0.5">Units</span></p>
                    </div>
                    <div className="h-8 w-[1px] bg-slate-200" />
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100">
                      <TrendingUp size={18} />
                    </div>
                  </div>
                </div>

                <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
                  {[
                    {
                      label: 'Total Units',
                      value: formatUnits(trendSummary.totalUnits),
                      subLabel: 'Forecast',
                      icon: Box,
                      color: 'from-emerald-500 to-teal-600',
                      borderColor: 'hover:border-emerald-200/60'
                    },
                    {
                      label: 'Weekly Demand',
                      value: formatUnits(trendSummary.avgUnitsPerWindow),
                      subLabel: 'Average',
                      icon: Activity,
                      color: 'from-violet-500 to-purple-600',
                      borderColor: 'hover:border-violet-200/60'
                    },
                    {
                      label: 'Top Product',
                      value: trendSummary.topProduct,
                      subLabel: 'Leader',
                      icon: Star,
                      color: 'from-sky-500 to-blue-600',
                      borderColor: 'hover:border-sky-200/60'
                    }
                  ].map((card, i) => {
                    const Icon = card.icon;
                    return (
                      <motion.div 
                        key={card.label}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.1 }}
                        whileHover={{ y: -4, scale: 1.02 }}
                        className={`group rounded-[2.5rem] border border-slate-200 bg-white/70 backdrop-blur-md p-6 shadow-sm transition-all hover:shadow-xl ${card.borderColor}`}
                      >
                        <div className="flex items-center justify-between mb-4">
                          <div className={`p-3 rounded-2xl bg-slate-50 text-slate-400 group-hover:bg-gradient-to-br ${card.color} group-hover:text-white transition-all duration-300`}>
                            <Icon size={20} strokeWidth={2.5} />
                          </div>
                          <span className="text-[10px] font-black uppercase tracking-widest text-slate-300 group-hover:text-slate-500 transition-colors">{card.subLabel}</span>
                        </div>
                        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">{card.label}</p>
                        <p className={`font-black text-slate-900 mt-2 truncate ${card.label === 'Top Product' ? 'text-lg' : 'text-3xl tabular-nums tracking-tight'}`}>{card.value}</p>
                      </motion.div>
                    );
                  })}
                </div>

              </div>

              {!showAllTrends && (
                <div className="max-h-[calc(94vh-300px)] overflow-y-auto px-5 py-6 sm:px-8">
                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
                    <div className="rounded-[2rem] border border-white/60 bg-white/70 backdrop-blur-xl p-6 shadow-[0_12px_40px_rgba(0,0,0,0.04)]">
                      <div className="flex items-center justify-between mb-6">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Demand Distribution</p>
                          <h4 className="text-lg font-black text-slate-900 mt-1">Top 5 Demand Leaders</h4>
                        </div>
                        <div className="h-8 w-8 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                          <TrendingUp size={16} className="text-emerald-500" />
                        </div>
                      </div>
                      <div className="h-[280px]">
                        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                          <BarChart data={trendData} margin={{ top: 20, right: 10, left: -20, bottom: 0 }}>
                            <defs>
                              <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#10b981" stopOpacity={1} />
                                <stop offset="100%" stopColor="#059669" stopOpacity={0.9} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 4" vertical={false} stroke="#e2e8f0" opacity={0.6} />
                            <XAxis 
                              dataKey="name" 
                              axisLine={false} 
                              tickLine={false} 
                              tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }} 
                              dy={10}
                            />
                            <YAxis 
                              axisLine={false} 
                              tickLine={false} 
                              tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }}
                            />
                            <Tooltip
                              cursor={false}
                              content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                  const data = payload[0].payload;
                                  return (
                                    <div className="rounded-2xl border border-white/40 bg-white/80 dark:bg-slate-900/90 backdrop-blur-xl px-4 py-3 shadow-[0_16px_32px_rgba(0,0,0,0.1)]">
                                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">{data.fullName || label}</p>
                                      <p className="text-xl font-black text-emerald-600">
                                        {formatUnits(data.value)}
                                        <span className="text-[10px] font-bold text-slate-400 ml-1.5 uppercase">Units</span>
                                      </p>
                                    </div>
                                  );
                                }
                                return null;
                              }}
                            />
                            <Bar 
                              dataKey="value" 
                              radius={[12, 12, 4, 4]} 
                              fill="url(#barGradient)"
                              barSize={45}
                              stroke="none"
                              strokeWidth={0}
                              activeBar={false}
                              animationDuration={1500}
                              animationBegin={300}
                              cursor="pointer"
                              onClick={(data) => {
                                if (data && data.name) {
                                  setSelectedHistoryProduct(data.fullName || data.name);
                                  setShowProductHistory(true);
                                }
                              }}
                            >
                              <LabelList
                                dataKey="value"
                                position="top"
                                formatter={(value) => formatUnits(value)}
                                offset={12}
                                style={{ fill: '#334155', fontSize: 11, fontWeight: 800, fontFamily: 'Inter, system-ui' }}
                              />
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <p className="text-[11px] font-black uppercase tracking-[0.15em] text-slate-500 mb-3">Ranking Snapshot</p>
                      <div className="space-y-3">
                        {allTrends.slice(0, 5).map((item, index) => {
                          const share = trendSummary.totalUnits > 0
                            ? Math.round((Number(item.value || 0) / trendSummary.totalUnits) * 100)
                            : 0;
                          return (
                            <div key={`${item.name}-${index}`} className="rounded-2xl border border-slate-100 bg-white px-4 py-4 shadow-sm hover:border-emerald-200 transition-colors group">
                              <div className="flex items-center justify-between gap-4">
                                <div className="flex min-w-0 items-center gap-4">
                                  <span className={`w-8 h-8 rounded-full text-xs font-black flex items-center justify-center border ${index === 0 ? 'bg-emerald-500 border-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'bg-slate-50 border-slate-100 text-slate-500'}`}>{index + 1}</span>
                                  <div className="min-w-0">
                                    <p className="text-sm font-bold text-slate-900 truncate group-hover:text-emerald-600 transition-colors">{item.name}</p>
                                    <p className="text-[10px] font-bold text-slate-400 mt-0.5 uppercase tracking-wider">{share}% of demand</p>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <p className="text-sm font-black text-slate-900 tabular-nums">{formatUnits(item.value)}</p>
                                  <p className="text-[10px] font-bold text-slate-400 mt-0.5 uppercase tracking-wider">units</p>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {showAllTrends && (
                <div className="max-h-[calc(94vh-300px)] overflow-auto px-5 py-5 sm:px-8">
                  <table className="w-full border-separate border-spacing-0">
                    <thead className="bg-slate-50 sticky top-0 z-10">
                      <tr>
                        {['Rank', 'Product', 'Forecast Units', 'Share'].map((label) => {
                          const isNumeric = ['Forecast Units', 'Share'].includes(label);
                          return (
                            <th
                              key={label}
                              className={`px-6 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 border-b border-r border-slate-200 last:border-r-0 ${isNumeric ? 'text-right' : 'text-left'}`}
                            >
                              {label}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {allTrends.slice(0, 100).map((item, index) => (
                        <tr 
                          key={`${item.name}-${index}`} 
                          className="hover:bg-slate-50/50 transition-colors cursor-pointer"
                          onClick={() => {
                            setSelectedHistoryProduct(item.fullName || item.name);
                            setShowProductHistory(true);
                          }}
                        >
                          <td className="px-6 py-4 border-r border-b border-slate-100 text-xs font-black text-slate-400">#{index + 1}</td>
                          <td className="px-6 py-4 border-r border-b border-slate-100 text-sm font-bold text-slate-800 truncate">{item.name}</td>
                          <td className="px-6 py-4 border-r border-b border-slate-100 text-sm font-black text-slate-900 tabular-nums text-right">{formatUnits(item.value)} units</td>
                          <td className="px-6 py-4 border-b border-slate-100 text-sm font-bold text-emerald-600 tabular-nums text-right">
                            {trendSummary.totalUnits > 0 ? `${Math.round((Number(item.value || 0) / trendSummary.totalUnits) * 100)}%` : '0%'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showFestivalPopup && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] flex items-center justify-center bg-transparent p-4 sm:p-6"
            onClick={() => setShowFestivalPopup(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 14 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-6xl overflow-hidden rounded-[2rem] border border-slate-200/90 bg-white shadow-[0_24px_56px_rgba(15,23,42,0.14)]"
            >
              <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-amber-50 via-white to-emerald-50 px-6 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-200 bg-amber-100 text-amber-700">
                    <Calendar size={18} />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">Festival Insights</p>
                    <h3 className="text-lg font-black text-slate-900">Festival Sales Popup</h3>
                  </div>
                </div>
                <button
                  onClick={() => setShowFestivalPopup(false)}
                  className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                  aria-label="Close festival popup"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="max-h-[75vh] overflow-y-auto p-6">
                <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
                    <select
                      value={festivalSelectedYear}
                      onChange={(e) => setFestivalSelectedYear(e.target.value)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-semibold text-slate-700"
                    >
                      {festivalYearOptions.map((yearValue) => (
                        <option key={`festival-year-${yearValue}`} value={yearValue}>{yearValue}</option>
                      ))}
                    </select>
                    <div className="inline-flex items-center rounded-xl border border-slate-200 bg-white p-1">
                      {[
                        { key: 'year', label: 'Year' },
                        { key: 'month', label: 'Month' },
                        { key: 'specific', label: 'Specific' },
                      ].map((item) => (
                        <button
                          key={item.key}
                          onClick={() => setFestivalViewMode(item.key)}
                          className={`rounded-lg px-3 py-2 text-[11px] font-bold ${festivalViewMode === item.key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                    <div className="inline-flex items-center rounded-xl border border-slate-200 bg-white p-1">
                      {[
                        { key: 'all', label: 'All' },
                        { key: 'past', label: 'Past' },
                        { key: 'upcoming', label: 'Upcoming' },
                      ].map((item) => (
                        <button
                          key={item.key}
                          onClick={() => setFestivalTimelineFilter(item.key)}
                          className={`rounded-lg px-3 py-2 text-[11px] font-bold ${festivalTimelineFilter === item.key ? 'bg-amber-500 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                    {festivalViewMode === 'month' && (
                      <select
                        value={festivalSelectedMonth}
                        onChange={(e) => setFestivalSelectedMonth(e.target.value)}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-semibold text-slate-700"
                      >
                        <option value="all">All months</option>
                        {festivalMonthsInYear.map((month) => (
                          <option key={month.value} value={month.value}>{month.label}</option>
                        ))}
                      </select>
                    )}
                    {festivalViewMode === 'specific' && (
                      <select
                        value={festivalSelectedKey}
                        onChange={(e) => setFestivalSelectedKey(e.target.value)}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-semibold text-slate-700"
                      >
                        <option value="all">All festivals</option>
                        {festivalOutlook.festivals.map((festival) => (
                          <option key={`festival-option-${festival.key}`} value={festival.key}>{festival.name}</option>
                        ))}
                      </select>
                    )}
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-right">
                      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700">Visible Festivals</p>
                      <p className="text-sm font-black text-emerald-800">{filteredFestivalRows.length}</p>
                      <p className="text-[10px] font-semibold text-emerald-700">Future limit: +2 years</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Actual vs Predicted</p>
                    <p className="text-[11px] font-semibold text-slate-500">
                      {festivalViewMode === 'year' ? 'Year view' : (festivalViewMode === 'month' ? 'Month view' : 'Specific festival view')} • Festival 7-day window
                    </p>
                  </div>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={festivalComparisonChartData} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 4" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 10, fontWeight: 700 }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 10, fontWeight: 700 }} />
                        <Tooltip
                          cursor={{ fill: 'rgba(15, 23, 42, 0.04)' }}
                          formatter={(value) => [formatUnits(value), '']}
                          labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName || ''}
                        />
                        <Bar dataKey="actual" name="Actual Sales" fill="#0f766e" radius={[7, 7, 0, 0]} />
                        <Bar dataKey="predicted" name="Predicted Sales" fill="#f59e0b" radius={[7, 7, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
                  <div className="grid grid-cols-12 border-b border-slate-100 bg-white px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                    <div className="col-span-4">Festival</div>
                    <div className="col-span-3 text-right">Date</div>
                    <div className="col-span-2 text-right">Actual</div>
                    <div className="col-span-3 text-right">Predicted</div>
                  </div>
                  <div className="max-h-64 overflow-y-auto bg-white">
                    {filteredFestivalRows.map((festival) => (
                      <div key={`festival-popup-${festival.key}-${festival.date}`} className="grid grid-cols-12 items-center border-b border-slate-100 px-4 py-3 text-sm last:border-b-0">
                        <div className="col-span-4 min-w-0">
                          <p className="truncate font-bold text-slate-900">{festival.name}</p>
                          <p className="text-[11px] font-semibold text-slate-500">{festival.category}</p>
                        </div>
                        <div className="col-span-3 text-right text-[12px] font-semibold text-slate-600">{formatFriendlyDate(festival.date)}</div>
                        <div className="col-span-2 text-right text-[12px] font-black text-slate-700">{formatUnits(Math.round(festival.actualWindowSales || 0))}</div>
                        <div className="col-span-3 text-right text-[12px] font-black text-slate-900">
                          {festival.projectedWindowSales != null ? formatUnits(Math.round(festival.projectedWindowSales)) : '--'}
                        </div>
                      </div>
                    ))}
                    {filteredFestivalRows.length === 0 && (
                      <div className="px-4 py-10 text-center">
                        <p className="text-sm font-bold text-slate-700">No festival found for selected filters</p>
                        <p className="mt-1 text-xs text-slate-500">Try switching from Past to Upcoming or change month/festival.</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Festival Stock Intelligence</p>
                      <p className="text-[12px] font-semibold text-slate-600">
                        {festivalStockInsights.focusedFestival?.name || 'Festival'}: past vs future stock demand + discount strategy
                      </p>
                    </div>
                    <select
                      value={festivalStockFocusKey}
                      onChange={(e) => setFestivalStockFocusKey(e.target.value)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-semibold text-slate-700"
                    >
                      <option value="all">Auto (first visible festival)</option>
                      {filteredFestivalRows.map((festival) => (
                        <option key={`focus-festival-${festival.key}-${festival.date}`} value={festival.key}>
                          {festival.name} ({formatFriendlyDate(festival.date)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    <table className="w-full border-separate border-spacing-0">
                      <thead className="sticky top-0 z-10 bg-white">
                        <tr>
                          {['Stock', 'Past Sold', 'Future Forecast', 'Gap', 'Discount', 'Suggestion'].map((label, idx) => (
                            <th
                              key={`festival-stock-th-${label}`}
                              className={`border-b border-slate-100 px-4 py-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400 ${idx === 0 || idx === 5 ? 'text-left' : 'text-right'}`}
                            >
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {festivalStockInsights.rows.map((row) => {
                          const gapClass = row.varianceUnits > 0 ? 'text-emerald-600' : (row.varianceUnits < 0 ? 'text-rose-600' : 'text-slate-500');
                          return (
                            <tr key={`festival-stock-row-${row.stockName}`} className="hover:bg-slate-50/60">
                              <td className="border-b border-slate-100 px-4 py-3 text-left text-sm font-bold text-slate-900">{row.stockName}</td>
                              <td className="border-b border-slate-100 px-4 py-3 text-right text-sm font-black text-slate-700 tabular-nums">{formatUnits(row.pastSold)}</td>
                              <td className="border-b border-slate-100 px-4 py-3 text-right text-sm font-black text-slate-900 tabular-nums">{formatUnits(row.futurePredicted)}</td>
                              <td className={`border-b border-slate-100 px-4 py-3 text-right text-sm font-black tabular-nums ${gapClass}`}>
                                {row.varianceUnits >= 0 ? '+' : ''}{formatUnits(row.varianceUnits)}
                                <span className="ml-1 text-[10px] font-semibold text-slate-500">({row.pastSold > 0 ? `${row.variancePct >= 0 ? '+' : ''}${Math.round(row.variancePct)}%` : '--'})</span>
                              </td>
                              <td className="border-b border-slate-100 px-4 py-3 text-right text-sm font-bold text-amber-700">{row.discountSuggestion}</td>
                              <td className="border-b border-slate-100 px-4 py-3 text-left text-[12px] font-semibold text-slate-600">{row.actionSuggestion}</td>
                            </tr>
                          );
                        })}
                        {festivalStockInsights.rows.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-4 py-8 text-center">
                              <p className="text-sm font-bold text-slate-700">Stock-level festival data not available for selected filter</p>
                              <p className="mt-1 text-xs text-slate-500">Upload richer product-wise sales history for deeper stock recommendations.</p>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showProductHistory && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 backdrop-blur-sm p-4 sm:p-6"
            onClick={() => setShowProductHistory(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-4xl overflow-hidden rounded-[2.5rem] border border-white/60 bg-white/80 dark:bg-slate-900/80 shadow-[0_32px_64px_rgba(0,0,0,0.15)] backdrop-blur-2xl"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-100 bg-white/50 px-8 py-6">
                <div>
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600">
                      <Clock size={20} />
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Order Intelligence</p>
                      <h2 className="text-xl font-black text-slate-900 dark:text-white">{selectedHistoryProduct}</h2>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setShowProductHistory(false)}
                    className="group flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-all hover:bg-slate-900 hover:text-white"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="max-h-[70vh] overflow-y-auto custom-scrollbar p-8">
                {productSpecificHistory.length > 0 ? (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="rounded-3xl border border-slate-100 bg-white/40 p-5">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Orders</p>
                        <p className="text-2xl font-black text-slate-900 mt-1">{productSpecificHistory.length}</p>
                      </div>
                      <div className="rounded-3xl border border-slate-100 bg-white/40 p-5">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Cumulative Qty</p>
                        <p className="text-2xl font-black text-emerald-600 mt-1">
                          {formatUnits(productSpecificHistory.reduce((sum, r) => sum + r.quantity, 0))}
                        </p>
                      </div>
                      <div className="rounded-3xl border border-slate-100 bg-white/40 p-5">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Unique Customers</p>
                        <p className="text-2xl font-black text-blue-600 mt-1">
                          {new Set(productSpecificHistory.map(r => r.customerId)).size}
                        </p>
                      </div>
                      <div className="rounded-3xl border border-emerald-100 bg-emerald-50/30 p-5">
                        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Current Stock</p>
                        <p className="text-2xl font-black text-emerald-700 mt-1">
                          {formatUnits(selectedProductMeta?.current_stock || selectedProductMeta?.stock || selectedProductMeta?.inventory || 0)}
                        </p>
                      </div>
                    </div>

                    <div className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">
                      <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-50/50 text-[10px] font-black uppercase tracking-widest text-slate-400">
                          <tr>
                            <th className="px-6 py-4">Customer</th>
                            <th className="px-6 py-4 text-right">Quantity</th>
                            <th className="px-6 py-4">Status</th>
                            <th className="px-6 py-4 text-right">Order Date</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {productSpecificHistory.map((row, idx) => (
                            <tr key={row.id || idx} className="hover:bg-slate-50/30 transition-colors group">
                              <td className="px-6 py-4">
                                <p className="text-sm font-bold text-slate-900 group-hover:text-emerald-600 transition-colors">{row.customerName}</p>
                                <p className="text-[10px] text-slate-400 uppercase font-medium">{row.orderId || 'Direct'}</p>
                              </td>
                              <td className="px-6 py-4 text-right font-black text-slate-700 tabular-nums">
                                {formatUnits(row.quantity)}
                              </td>
                              <td className="px-6 py-4">
                                <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${
                                  row.paymentStatus === 'Paid' ? 'bg-emerald-100 text-emerald-700' : 
                                  row.paymentStatus === 'Partial' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
                                }`}>
                                  {row.paymentStatus}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-right text-xs font-bold text-slate-500">
                                {row.orderDate || 'N/A'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 mb-4">
                      <Search size={32} />
                    </div>
                    <p className="text-sm font-bold text-slate-900">No purchase history found</p>
                    <p className="text-xs text-slate-500 mt-1">Unable to locate customer transaction data for this product.</p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="bg-slate-50 px-8 py-4 text-center border-t border-slate-100">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  Live insights powered by AI demand forecasting
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ForecastViewer;
