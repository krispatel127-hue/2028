// SVG circle constants for health score
const HEALTH_CIRCLE_RADIUS = 26;
const HEALTH_CIRCLE_CIRC = 2 * Math.PI * HEALTH_CIRCLE_RADIUS;
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import GlassCard from '../components/GlassCard';
import PredictionChart from '../components/PredictionChart';
import FullScreenChart from '../components/FullScreenChart';
import AIPulse from '../components/AIPulse';
import ProductPurchaseModal from '../components/ProductPurchaseModal';
import ProcessCard from '../components/ProcessCard';
import {
  TrendingUp,
  AlertCircle,
  Package,
  BrainCircuit,
  Zap,
  CheckCircle2,
  ArrowUpRight,
  ShoppingCart,
  Factory,
  Loader2,
  Target,
  ShieldCheck,
  Activity,
  ChevronRight,
  Sparkles,
  Users,
  Mail,
  Phone,
  MapPin,
  Eye,
  X,
  RefreshCw,
  Download,
  Share2,
  AlertTriangle,
  BarChart3,
  ArrowRight,
  ClipboardList,
  Database,
  Briefcase
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../api/client';
import { useAnalysis } from '../context/useAnalysis';
import { useLayoutFullscreen } from '../context/LayoutContext';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  LineChart,
  Line,
} from 'recharts';

const ICON_MAP = {
  TrendingUp, AlertCircle, Package, BrainCircuit, ShoppingCart, Factory, Zap, Target
};
const LAST_ANALYSIS_STORAGE_KEY = 'ai-ops-last-analysis-snapshot';

const RETENTION_LEVELS = ['MINOR_DROP', 'MAJOR_DROP', 'NOT_PURCHASED', 'NEW_CUSTOMER', 'MIXED_PERFORMANCE', 'THODA_KAM', 'BAHUT_KAM', 'LIYA_HI_NAHI'];
const CUSTOMER_NAME_KEYS = ['customer_name', 'customer', 'client', 'client_name', 'company', 'company_name', 'party', 'party_name', 'buyer', 'account_name'];
const CUSTOMER_ID_KEYS = ['customer_id', 'customerid', 'party_id', 'party_code', 'partycode', 'account_id', 'accountid', 'code', 'ledger_code'];
const EMAIL_KEYS = ['email', 'email_id', 'emailid', 'emailaddress', 'customer_email', 'client_email', 'mail_id', 'mail', 'e-mail'];
const PHONE_KEYS = ['phone', 'phone_no', 'phone_number', 'mobile', 'mobile_no', 'contact', 'contact_number', 'contactno', 'whatsapp'];
const ADDRESS_KEYS = ['address', 'billing_address', 'shipping_address', 'company_address', 'location', 'city', 'area', 'region'];

const toNum = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeKey = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const pickFromRow = (row, keys = []) => {
  if (!row || typeof row !== 'object') return null;
  const normalized = Object.keys(row).reduce((acc, key) => {
    acc[normalizeKey(key)] = key;
    return acc;
  }, {});

  for (const key of keys) {
    const normalizedKey = normalizeKey(key);
    const originalKey = normalized[normalizedKey];
    if (originalKey && row[originalKey] !== null && row[originalKey] !== undefined && row[originalKey] !== '') {
      return row[originalKey];
    }
  }
  return null;
};

const normalizePhoneKey = (value) => String(value || '').replace(/\D/g, '').trim();

const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});

const toInputMonth = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const toStartOfDay = (value) => new Date(value.getFullYear(), value.getMonth(), value.getDate());

const getWeekOffsetFromLabel = (value) => {
  const text = String(value || '').trim();
  const match = text.match(/^W(?:EEK)?\s*\+?\s*(\d+)$/i);
  if (!match) return null;
  const weekNumber = Number(match[1]);
  if (!Number.isFinite(weekNumber) || weekNumber <= 0) return null;
  return (weekNumber - 1) * 7;
};

const getHorizonWindowDays = (horizon, referenceDate = new Date()) => {
  if (horizon === 'week') return 7;
  if (horizon === 'month') {
    const daysInCurrentMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0).getDate();
    return daysInCurrentMonth >= 31 ? 31 : 30;
  }
  return 365;
};

const getFutureOffsetDays = (row = {}, fallbackIndex = 0, baseDate = toStartOfDay(new Date())) => {
  const rawDate = row?.date || row?.period || row?.name;
  const parsed = parseDate(rawDate);
  if (parsed) {
    const normalized = toStartOfDay(parsed);
    return Math.floor((normalized - baseDate) / DAY_MS);
  }

  const weekOffset = getWeekOffsetFromLabel(rawDate);
  if (weekOffset != null) return weekOffset;

  return Number.isFinite(fallbackIndex) ? fallbackIndex : null;
};

const getHorizonPointLimit = (horizon, timeGrouping, referenceDate = new Date()) => {
  const windowDays = getHorizonWindowDays(horizon, referenceDate);
  if (timeGrouping === 'weekly') return Math.ceil(windowDays / 7);
  return windowDays;
};

const parseDate = (value) => {
  if (!value) return null;
  if (typeof value === 'string') {
    const raw = value.trim();
    const hasExplicitYear = /\b\d{4}\b/.test(raw);
    const isISODate = /^\d{4}-\d{1,2}-\d{1,2}/.test(raw);
    const isSlashDateWithYear = /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(raw);
    if (!hasExplicitYear && !isISODate && !isSlashDateWithYear) return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseTimelineDate = (value, fallbackIndex = 0, baseDate = toStartOfDay(new Date())) => {
  const direct = parseDate(value);
  if (direct) return direct;

  const raw = String(value || '').trim();
  if (!raw) return null;

  const weekOffset = getWeekOffsetFromLabel(raw);
  if (weekOffset != null) {
    return new Date(baseDate.getTime() + (weekOffset * DAY_MS));
  }

  const weekOfMatch = raw.match(/^week\s+of\s+([a-z]{3,9})\s+(\d{1,2})$/i);
  if (weekOfMatch) {
    const monthName = weekOfMatch[1];
    const day = Number(weekOfMatch[2]);
    const year = baseDate.getFullYear();
    const guess = new Date(`${monthName} ${day}, ${year}`);
    if (!Number.isNaN(guess.getTime())) return guess;
  }

  const monthDayMatch = raw.match(/^([a-z]{3,9})\s+(\d{1,2})$/i);
  if (monthDayMatch) {
    const monthName = monthDayMatch[1];
    const day = Number(monthDayMatch[2]);
    const year = baseDate.getFullYear();
    const guess = new Date(`${monthName} ${day}, ${year}`);
    if (!Number.isNaN(guess.getTime())) return guess;
  }

  if (Number.isFinite(fallbackIndex)) {
    return new Date(baseDate.getTime() + (Math.max(0, fallbackIndex) * DAY_MS));
  }

  return null;
};

const deriveCustomerTrendKey = (customer = {}) => {
  const explicit = String(customer.monthly_trend || '').toLowerCase();
  if (explicit === 'up' || explicit === 'down' || explicit === 'flat') return explicit;

  const risk = String(customer.risk || '').toUpperCase();
  const intensity = String(customer.intensity_level || '').toUpperCase();

  if (risk.includes('CHURN') || intensity.includes('LIYA_HI_NAHI') || intensity.includes('BAHUT_KAM')) return 'down';
  if (risk.includes('WATCH') || intensity.includes('THODA_KAM')) return 'flat';
  return 'up';
};

const isMeaningfulText = (value) => {
  const text = String(value || '').trim();
  if (!text) return false;
  const upper = text.toUpperCase();
  if (['UNKNOWN', 'N/A', 'NA', '-', 'NONE', 'NULL', 'INDIVIDUAL', 'PARTYUNKNOWN'].includes(upper)) return false;
  return true;
};

const toProfessionalPartyText = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';

  if (/^party\s*\d+$/i.test(text)) {
    const digits = text.replace(/\D/g, '');
    return `Party ${digits}`;
  }

  if (/^\d+$/.test(text)) return `Party ${text}`;

  const cleaned = text
    .replace(/^party[_\s-]*/i, 'Party ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || text;
};

const getFieldFallback = (value) => {
  if (!isMeaningfulText(value)) return 'Not available';
  return String(value).trim();
};

const hasUsableAnalysisPayload = (payload) => Boolean(
  payload && (
    (Array.isArray(payload?.products) && payload.products.length > 0)
    || (Array.isArray(payload?.products_analysis) && payload.products_analysis.length > 0)
    || (Array.isArray(payload?.customers) && payload.customers.length > 0)
    || (Array.isArray(payload?.demand_forecast) && payload.demand_forecast.length > 0)
    || (Array.isArray(payload?.past_sales_daily) && payload.past_sales_daily.length > 0)
    || (Array.isArray(payload?.past_sales) && payload.past_sales.length > 0)
  )
);

const readStoredAnalysisSnapshot = () => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LAST_ANALYSIS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return hasUsableAnalysisPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const getCustomerDisplayName = (customer = {}) => {
  const emailPrefix = String(customer?.email || '').split('@')[0] || '';
  const candidates = [
    customer?.company,
    customer?.customer_name,
    customer?.name,
    customer?.customer_id,
    emailPrefix,
  ].filter(isMeaningfulText);

  const nonNumeric = candidates.find((c) => !/^\d+$/.test(String(c).trim()));
  const rawName = String(nonNumeric || candidates[0] || '').trim();

  if (!isMeaningfulText(rawName)) {
    const idCandidate = String(customer?.customer_id || '').trim();
    if (idCandidate) return toProfessionalPartyText(idCandidate);
    return 'Client Account';
  }

  return toProfessionalPartyText(rawName);
};

const getCustomerSubtitle = (customer = {}, displayName = '') => {
  const company = isMeaningfulText(customer?.company) ? toProfessionalPartyText(String(customer.company).trim()) : '';
  const customerId = String(customer?.customer_id || '').trim();
  const display = String(displayName || '').trim().toUpperCase();
  if (company && company.toUpperCase() !== display) return company;
  if (customerId && toProfessionalPartyText(customerId).toUpperCase() !== display) return toProfessionalPartyText(customerId);
  return customerId ? toProfessionalPartyText(customerId) : 'Direct Client';
};

const getRecentActivityLabel = (customer = {}) => {
  const directDate = customer?.last_purchase_date || customer?.last_order_date;
  if (directDate) return String(directDate);

  const monthly = Array.isArray(customer?.monthly_breakdown) ? customer.monthly_breakdown : [];
  const latestMonth = monthly
    .map((m) => String(m?.month || '').trim())
    .filter((m) => /^\d{4}-\d{2}$/.test(m))
    .sort()
    .pop();
  return latestMonth ? `${latestMonth} period` : 'Recent';
};

const buildCustomerLookupFromRows = (rows = []) => {
  const byId = new Map();
  const byEmail = new Map();
  const byPhone = new Map();

  rows.forEach((row) => {
    const name = pickFromRow(row, CUSTOMER_NAME_KEYS);
    const id = pickFromRow(row, CUSTOMER_ID_KEYS);
    const email = pickFromRow(row, EMAIL_KEYS);
    const phone = pickFromRow(row, PHONE_KEYS);

    if (isMeaningfulText(name)) {
      if (id) byId.set(String(id).trim().toLowerCase(), toProfessionalPartyText(name));
      if (email) byEmail.set(String(email).trim().toLowerCase(), toProfessionalPartyText(name));
      if (phone) byPhone.set(normalizePhoneKey(phone), toProfessionalPartyText(name));
    }
  });

  return { byId, byEmail, byPhone };
};

const resolveCustomerIdentity = (customer = {}, lookup = null) => {
  const localName = [
    customer?.party_name,
    customer?.customer_name,
    customer?.company_name,
    customer?.company,
    customer?.client_name,
    customer?.account_name,
    customer?.name,
    customer?.customer,
    pickFromRow(customer, CUSTOMER_NAME_KEYS),
  ].find(isMeaningfulText) || null;

  const idCandidate = String(
    customer?.party_id
    || customer?.party_code
    || customer?.customer_id
    || customer?.account_id
    || pickFromRow(customer, CUSTOMER_ID_KEYS)
    || ''
  ).trim();
  const emailCandidate = String(customer?.email || pickFromRow(customer, EMAIL_KEYS) || '').trim();
  const phoneCandidate = String(customer?.phone || pickFromRow(customer, PHONE_KEYS) || '').trim();

  const idKey = idCandidate ? idCandidate.toLowerCase() : '';
  const emailKey = emailCandidate ? emailCandidate.toLowerCase() : '';
  const phoneKey = phoneCandidate ? normalizePhoneKey(phoneCandidate) : '';

  const lookupName = lookup
    ? (idKey ? lookup.byId.get(idKey) : null)
      || (emailKey ? lookup.byEmail.get(emailKey) : null)
      || (phoneKey ? lookup.byPhone.get(phoneKey) : null)
      || null
    : null;

  const resolvedName = localName
    || lookupName
    || (idCandidate ? `Party ${idCandidate}` : null)
    || 'Client Account';

  return {
    resolvedName: toProfessionalPartyText(resolvedName),
    idCandidate,
    emailCandidate: emailCandidate || null,
    phoneCandidate: phoneCandidate || null,
  };
};

const buildCustomersFromCustomerAnalysis = (rows = []) => rows.map((c, idx) => {
  const resolvedName = [
    c?.party_name,
    c?.customer_name,
    c?.company_name,
    c?.company,
    c?.client_name,
    c?.customer,
    c?.name,
  ].find(isMeaningfulText) || c?.customer || `Customer-${idx + 1}`;

  const freq = toNum(c?.frequency, 0);
  let intensityLevel = 'HEALTHY';
  let intensityLabel = 'ACTIVE';
  let risk = 'ACTIVE';
  if (freq <= 0 || c?.low_activity) {
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

  const monthlyBreakdown = Array.isArray(c?.monthly_breakdown) ? c.monthly_breakdown : [];
  const latestMonth = monthlyBreakdown
    .map((m) => String(m?.month || '').trim())
    .filter((m) => /^\d{4}-\d{2}$/.test(m))
    .sort()
    .pop() || null;

  return {
    id: idx + 1,
    customer_id: c?.customer_id || c?.customer || `CUST-${idx + 1}`,
    customer_name: toProfessionalPartyText(resolvedName),
    company: toProfessionalPartyText(resolvedName),
    total_purchase: toNum(c?.total_purchase, 0),
    frequency: freq,
    intensity_level: intensityLevel,
    intensity_label: intensityLabel,
    risk,
    reason: c?.low_activity ? 'Low purchase activity based on frequency analysis' : 'Active account',
    email: c?.email || c?.customer_email || c?.mail_id || null,
    phone: c?.phone || c?.mobile || c?.contact_number || null,
    address: c?.address || c?.location || c?.city || null,
    last_order_date: c?.last_order_date || c?.last_purchase_date || (latestMonth ? `${latestMonth}-01` : null),
    monthly_trend: c?.monthly_trend || (risk === 'CHURN_RISK' ? 'down' : (risk === 'WATCH' ? 'flat' : 'up')),
    monthly_breakdown: monthlyBreakdown,
  };
});

const buildCustomersFromProducts = (products = []) => {
  const out = [];
  products.forEach((p) => {
    const topCustomers = Array.isArray(p?.top_customers) ? p.top_customers : [];
    topCustomers.forEach((c) => {
      const resolvedName = [c?.party_name, c?.customer_name, c?.company_name, c?.company, c?.name, c?.client_name].find(isMeaningfulText) || c?.customer_id;
      if (!resolvedName && !c?.customer_id) return;
      const totalPurchased = toNum(c?.total_purchased ?? c?.total_purchase, 0);
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

      out.push({
        customer_id: c?.customer_id || '',
        customer_name: toProfessionalPartyText(resolvedName || ''),
        company: toProfessionalPartyText(c?.company || c?.name || resolvedName || ''),
        total_purchase: totalPurchased,
        intensity_level: intensityLevel,
        intensity_label: intensityLabel,
        risk,
        reason: c?.trend_tag || (risk === 'CHURN_RISK' ? 'Low purchase activity detected' : 'Customer is active'),
        email: c?.email || c?.customer_email || c?.mail_id || null,
        phone: c?.phone || c?.mobile || c?.contact_number || null,
        address: c?.address || c?.location || c?.city || null,
        last_order_date: c?.last_order || c?.last_order_date || null,
        monthly_trend: trendTag.includes('UP') ? 'up' : (trendTag.includes('DROP') || risk === 'CHURN_RISK' ? 'down' : (risk === 'WATCH' ? 'flat' : 'up')),
      });
    });
  });
  return out;
};

const buildCustomersFromRows = (rows = []) => {
  const byCustomer = new Map();
  rows.forEach((row) => {
    const name = pickFromRow(row, CUSTOMER_NAME_KEYS);
    const customerId = pickFromRow(row, CUSTOMER_ID_KEYS);
    const email = pickFromRow(row, EMAIL_KEYS);
    const phone = pickFromRow(row, PHONE_KEYS);
    const address = pickFromRow(row, ADDRESS_KEYS);

    const key = String(customerId || name || email || phone || '').trim();
    if (!key) return;
    if (!byCustomer.has(key)) {
      const resolved = isMeaningfulText(name) ? toProfessionalPartyText(name) : (customerId ? `Party ${String(customerId).trim()}` : 'Client Account');
      byCustomer.set(key, {
        customer_id: customerId || key,
        customer_name: resolved,
        company: resolved,
        total_purchase: 0,
        intensity_level: 'HEALTHY',
        intensity_label: 'ACTIVE',
        risk: 'ACTIVE',
        reason: 'Customer profile from sheet preview',
        email: email || null,
        phone: phone || null,
        address: address || null,
        last_order_date: null,
        monthly_trend: 'up',
      });
    } else {
      const existing = byCustomer.get(key);
      existing.email = existing.email || email || null;
      existing.phone = existing.phone || phone || null;
      existing.address = existing.address || address || null;
    }
  });
  return Array.from(byCustomer.values());
};

const mergeCustomerRecord = (current = {}, incoming = {}) => ({
  ...current,
  ...incoming,
  customer_id: incoming.customer_id || current.customer_id,
  customer_name: isMeaningfulText(incoming.customer_name) ? incoming.customer_name : current.customer_name,
  company: isMeaningfulText(incoming.company) ? incoming.company : current.company,
  email: incoming.email || current.email || null,
  phone: incoming.phone || current.phone || null,
  address: incoming.address || current.address || null,
  last_order_date: incoming.last_order_date || current.last_order_date || null,
  total_purchase: Math.max(toNum(current.total_purchase, 0), toNum(incoming.total_purchase, 0)),
  risk: incoming.risk || incoming.risk_level || current.risk || 'ACTIVE',
  intensity_level: incoming.intensity_level || current.intensity_level || 'HEALTHY',
  intensity_label: incoming.intensity_label || current.intensity_label || 'ACTIVE',
  reason: incoming.reason || current.reason || 'Customer profile from analysis',
  monthly_trend: incoming.monthly_trend || current.monthly_trend || 'up',
});

const detectCurrencyCode = (analysis) => {
  const metadata = analysis?.metadata || {};
  const explicit = String(metadata?.currency_code || metadata?.currency || '').trim().toUpperCase();
  if (explicit) return explicit;

  const reportText = [
    ...(Array.isArray(metadata?.ingestion_report) ? metadata.ingestion_report : []),
    ...(Array.isArray(metadata?.ingestion_warnings) ? metadata.ingestion_warnings : []),
  ].join(' ').toUpperCase();

  if (reportText.includes('USD') || reportText.includes('$')) return 'USD';
  if (reportText.includes('EUR') || reportText.includes('€')) return 'EUR';
  if (reportText.includes('GBP') || reportText.includes('£')) return 'GBP';
  return 'INR';
};

const getWeekStart = (date) => {
  const base = new Date(date);
  const day = base.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  base.setDate(base.getDate() + diff);
  base.setHours(0, 0, 0, 0);
  return base;
};

const aggregateWeekly = (rows, { valueKeys = [], mode = 'sum', labelPrefix = 'Week of ' } = {}) => {
  if (!rows || rows.length === 0) return [];
  const sampleDate = parseDate(rows[0]?.period || rows[0]?.name);
  if (!sampleDate) return rows;

  const groups = new Map();

  rows.forEach((row) => {
    const date = parseDate(row.period || row.name);
    if (!date) return;
    const weekStart = getWeekStart(date);
    const key = weekStart.toISOString().slice(0, 10);

    if (!groups.has(key)) {
      groups.set(key, {
        totals: Object.fromEntries(valueKeys.map((k) => [k, 0])),
        count: 0,
        label: `${labelPrefix}${SHORT_DATE_FORMATTER.format(weekStart)}`,
      });
    }

    const group = groups.get(key);
    valueKeys.forEach((keyName) => {
      const value = Number(row[keyName] ?? 0);
      group.totals[keyName] += Number.isNaN(value) ? 0 : value;
    });
    group.count += 1;
  });

  return Array.from(groups.entries())
    .sort((a, b) => new Date(a[0]) - new Date(b[0]))
    .map(([, group]) => {
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

const normalizeActualRows = (rows = []) => rows
  .map((d) => ({
    period: d.date || d.period || d.name, // Prioritize date for chart axis
    actual: Number(
      d.actual
      ?? d.value
      ?? d.sales
      ?? d.quantity
      ?? d.quantity_sold
      ?? d.units
      ?? d.total_sales
      ?? d.amount
      ?? 0
    ),
  }))
  .filter((row) => row.period);

const SALES_DATE_KEYS = [
  'date', 'order_date', 'sales_date', 'transaction_date', 'invoice_date',
  'bill_date', 'created_at', 'timestamp', 'month',
];

const SALES_VALUE_KEYS = [
  'quantity_sold', 'quantity', 'qty', 'units', 'unit',
  'sale_qty', 'sales_qty', 'sold_qty', 'total_sales',
  'amount', 'value', 'net_amount', 'order_stock', 'order_qty',
];

const parseLooseDate = (value) => {
  const direct = parseDate(value);
  if (direct) return direct;

  const raw = String(value || '').trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}$/.test(raw)) {
    const dt = new Date(`${raw}-01`);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  if (/^\d{2}-\d{4}$/.test(raw)) {
    const [mm, yyyy] = raw.split('-');
    const dt = new Date(`${yyyy}-${mm}-01`);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  return null;
};

const derivePastSalesFromPreviewRows = (rows = []) => {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const bucket = new Map();

  rows.forEach((row) => {
    const dateRaw = pickFromRow(row, SALES_DATE_KEYS) || row?.date || row?.Date;
    const dt = parseLooseDate(dateRaw);
    if (!dt) return;

    const dayKey = toIsoDay(dt);
    const qtyRaw = pickFromRow(row, SALES_VALUE_KEYS);
    const qty = toNum(qtyRaw, NaN);
    if (!Number.isFinite(qty) || qty <= 0) return;

    bucket.set(dayKey, toNum(bucket.get(dayKey), 0) + qty);
  });

  return Array.from(bucket.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, total]) => ({ period, actual: Math.round(total) }));
};

const buildFallbackForecastFromPast = (pastRows = [], horizonDays = 90) => {
  if (!Array.isArray(pastRows) || pastRows.length === 0) return [];

  const values = pastRows.map((r) => toNum(r?.actual, 0)).filter((v) => Number.isFinite(v) && v > 0);
  if (!values.length) return [];

  const recent = values.slice(-Math.min(7, values.length));
  const avg = recent.reduce((s, v) => s + v, 0) / Math.max(1, recent.length);
  const baseline = Math.max(1, avg);
  const lastDate = parseLooseDate(pastRows[pastRows.length - 1]?.period) || new Date();
  const start = toStartOfDay(lastDate);

  return Array.from({ length: horizonDays }).map((_, idx) => {
    const date = new Date(start);
    date.setDate(start.getDate() + idx + 1);
    const predicted = baseline;
    return {
      period: toIsoDay(date),
      predicted: Math.round(predicted),
      lower: Math.max(0, predicted * 0.9),
      upper: Math.max(0, predicted * 1.1),
      production: Math.max(0, Math.round(predicted * 1.15)),
    };
  });
};

const buildFallbackAnalysisFromLatestPayload = (latestPayload = {}) => {
  const previewRows = Array.isArray(latestPayload?.preview_rows) ? latestPayload.preview_rows : [];
  if (!previewRows.length) return null;

  const pastDaily = derivePastSalesFromPreviewRows(previewRows);
  const forecastRows = buildFallbackForecastFromPast(pastDaily, 90);
  const customers = buildCustomersFromRows(previewRows);

  const totalSales = pastDaily.reduce((sum, row) => sum + toNum(row?.actual, 0), 0);

  return {
    analysis_isolation: {
      session_id: `upload-${latestPayload?.upload_id || 'preview'}-fallback`,
      sheet_id: latestPayload?.upload_id || null,
      sheet_name: latestPayload?.sheet_name || latestPayload?.file_name || 'Uploaded Sheet',
    },
    confidence_score: 60,
    confidence_label: 'MEDIUM',
    inventory_summary: {
      total_sales: Math.round(totalSales),
      total_products: 0,
      total_stock: 0,
      total_revenue: 0,
    },
    stock_analysis: {
      out_of_stock_items: 0,
      low_stock_items: 0,
      deadstock_items: 0,
      overstock_items: 0,
      healthy_items: 0,
    },
    summary: {
      out_of_stock: 0,
      low_stock: 0,
      deadstock: 0,
      overstock: 0,
      healthy: 0,
    },
    customers,
    products: [],
    products_analysis: [],
    customer_analysis: [],
    recommendations: [],
    past_sales_daily: pastDaily,
    past_sales_weekly: aggregateWeekly(pastDaily, { valueKeys: ['actual'], mode: 'sum' }),
    demand_forecast: forecastRows,
    forecast: {
      next_365_days: forecastRows.map((r) => toNum(r?.predicted, 0)),
    },
    metadata: {
      sheet_previews: [{ rows: previewRows }],
      fallback_source: 'preview_rows',
    },
  };
};

const normalizeForecastRows = (rows = []) => rows
  .map((d) => ({
    period: d.date || d.period || d.name || 'Data not available',
    predicted: Math.round(Number(d.predicted ?? d.predicted_demand ?? d.value ?? 0)),
    lower: d.lower_bound != null ? Number(d.lower_bound) : Number(d.lower ?? 0),
    upper: d.upper_bound != null ? Number(d.upper_bound) : Number(d.upper ?? 0),
    production: d.production != null
      ? Number(d.production)
      : Math.round(Number(d.predicted_demand ?? d.predicted ?? d.value ?? 0) * 1.15),
  }))
  .filter((row) => row.period);

const aggregateForecastByPeriod = (rows = []) => {
  const byPeriod = new Map();

  rows.forEach((row) => {
    const key = String(row?.period || '').trim();
    if (!key) return;

    if (!byPeriod.has(key)) {
      byPeriod.set(key, {
        period: key,
        predicted: 0,
        lower: 0,
        upper: 0,
        production: 0,
      });
    }

    const entry = byPeriod.get(key);
    entry.predicted += toNum(row?.predicted, 0);
    entry.lower += toNum(row?.lower, 0);
    entry.upper += toNum(row?.upper, 0);
    entry.production += toNum(row?.production, 0);
  });

  return Array.from(byPeriod.values());
};

const padDailyForecastWindow = (rows = [], horizonDays = 30, startDate = new Date()) => {
  if (!Array.isArray(rows) || rows.length === 0 || horizonDays <= 0) return rows;

  const baseDate = toStartOfDay(startDate);
  const byOffset = new Map();

  rows.forEach((row, idx) => {
    const offset = getFutureOffsetDays(row, idx, baseDate);
    if (!Number.isFinite(offset) || offset < 0) return;
    byOffset.set(offset, row);
  });

  let lastKnown = rows[0];
  const padded = [];

  for (let day = 0; day < horizonDays; day += 1) {
    const existing = byOffset.get(day);
    if (existing) {
      padded.push(existing);
      lastKnown = existing;
      continue;
    }

    const date = new Date(baseDate);
    date.setDate(baseDate.getDate() + day);
    padded.push({
      period: toIsoDay(date),
      predicted: toNum(lastKnown?.predicted, 0),
      lower: toNum(lastKnown?.lower, toNum(lastKnown?.predicted, 0) * 0.9),
      upper: toNum(lastKnown?.upper, toNum(lastKnown?.predicted, 0) * 1.1),
      production: toNum(lastKnown?.production, toNum(lastKnown?.predicted, 0) * 1.15),
    });
  }

  return padded;
};

const isWeeklyBucketLabel = (value) => getWeekOffsetFromLabel(value) != null;

const toIsoDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
};

const expandWeeklyForecastToDaily = (rows = [], startDate = new Date()) => {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const start = toStartOfDay(startDate);
  const sorted = [...rows].sort((a, b) => {
    const aOffset = getWeekOffsetFromLabel(a?.period || a?.name || a?.date) ?? 0;
    const bOffset = getWeekOffsetFromLabel(b?.period || b?.name || b?.date) ?? 0;
    return aOffset - bOffset;
  });

  const out = [];
  sorted.forEach((row) => {
    const weekOffset = getWeekOffsetFromLabel(row?.period || row?.name || row?.date) ?? 0;
    const predictedDaily = toNum(row?.predicted, toNum(row?.predicted_demand, 0)) / 7;
    const lowerDaily = toNum(row?.lower, toNum(row?.lower_bound, 0)) / 7;
    const upperDaily = toNum(row?.upper, toNum(row?.upper_bound, 0)) / 7;
    const productionDaily = toNum(row?.production, toNum(row?.predicted, toNum(row?.predicted_demand, 0)) * 1.15) / 7;

    for (let day = 0; day < 7; day += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + weekOffset + day);
      out.push({
        period: toIsoDay(date),
        predicted: Math.max(0, Math.round(predictedDaily)),
        lower: Math.max(0, lowerDaily),
        upper: Math.max(0, upperDaily),
        production: Math.max(0, Math.round(productionDaily)),
      });
    }
  });

  return out;
};

const buildDailyForecastFromAnalysis = (analysisPayload = {}) => {
  const daily365 = Array.isArray(analysisPayload?.forecast?.next_365_days)
    ? analysisPayload.forecast.next_365_days
    : [];

  if (daily365.length > 0) {
    const start = toStartOfDay(new Date());
    return daily365
      .map((value, idx) => {
        const date = new Date(start);
        date.setDate(start.getDate() + idx);
        const predicted = toNum(value, 0);
        return {
          period: toIsoDay(date),
          predicted: Math.max(0, Math.round(predicted)),
          lower: Math.max(0, predicted * 0.9),
          upper: Math.max(0, predicted * 1.1),
          production: Math.max(0, Math.round(predicted * 1.15)),
        };
      })
      .filter((row) => row.period);
  }

  const demandForecastRows = Array.isArray(analysisPayload?.demand_forecast) ? analysisPayload.demand_forecast : [];
  const normalized = aggregateForecastByPeriod(normalizeForecastRows(demandForecastRows));
  if (!normalized.length) return [];

  const hasDailyDates = normalized.some((row) => parseDate(row?.period));
  if (hasDailyDates) return normalized;

  const hasWeeklyBuckets = normalized.some((row) => isWeeklyBucketLabel(row?.period));
  if (hasWeeklyBuckets) return expandWeeklyForecastToDaily(normalized, new Date());

  return normalized;
};

const withTimeout = async (promise, timeoutMs = 5000) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Request timeout')), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
});

const aggregateMonthly = (rows = [], { valueKeys = [], mode = 'sum' } = {}) => {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const groups = new Map();

  rows.forEach((row, idx) => {
    const date = parseDate(row?.period || row?.name || row?.date) || new Date();
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

const aggregateYearly = (rows = [], { valueKeys = [], mode = 'sum' } = {}) => {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const groups = new Map();

  rows.forEach((row, idx) => {
    const date = parseDate(row?.period || row?.name || row?.date) || new Date();
    if (!date) return;

    const year = date.getFullYear();
    const key = String(year);

    if (!groups.has(key)) {
      groups.set(key, {
        totals: Object.fromEntries(valueKeys.map((item) => [item, 0])),
        count: 0,
        label: key,
        order: year,
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

const filterRowsByGranularity = (rows = [], granularity, selectedDay, selectedMonth, selectedYear) => {
  return rows.filter((row) => {
    const date = parseDate(row?.period || row?.name || row?.date);
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

const isTimeoutError = (err) => String(err?.message || '').toLowerCase().includes('timeout');
const DASHBOARD_FAST_TIMEOUT_MS = 8000;
const DASHBOARD_FORECAST_TIMEOUT_MS = 10000;
const DASHBOARD_FORECAST_CACHE_TTL_MS = 5 * 60 * 1000;
const DASHBOARD_FORECAST_RETRY_COOLDOWN_MS = 60 * 1000;

const getWithTimeout = (url, timeoutMs = DASHBOARD_FAST_TIMEOUT_MS) => api.get(url, { timeout: timeoutMs });

const fetchLatestAnalysisWithRetry = async (timeoutMs) => {
  try {
    return await getWithTimeout('/ingestion/latest-analysis/', timeoutMs);
  } catch (firstErr) {
    if (!isTimeoutError(firstErr)) throw firstErr;
    // One fast retry helps when backend workers are under temporary load.
    return await getWithTimeout('/ingestion/latest-analysis/', timeoutMs + 2000);
  }
};

const ChartMountContainer = ({ className = 'h-56', children }) => {
  const hostRef = useRef(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return undefined;

    const updateReady = () => {
      const rect = node.getBoundingClientRect();
      setIsReady(rect.width > 24 && rect.height > 24);
    };

    updateReady();
    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(updateReady);
      observer.observe(node);
    }
    window.addEventListener('resize', updateReady);

    return () => {
      window.removeEventListener('resize', updateReady);
      if (observer) observer.disconnect();
    };
  }, []);

  return (
    <div ref={hostRef} className={className}>
      {isReady ? children : <div className="w-full h-full min-h-[220px]" />}
    </div>
  );
};

const Dashboard = () => {
  const { analysis: liveAnalysis, latestMeta, selectedUploadId, isLocked } = useAnalysis();
  const { isLayoutFullscreen, enableFullscreen, disableFullscreen } = useLayoutFullscreen();
  const navigate = useNavigate();
  const initialAnalysisSnapshotRef = useRef(
    hasUsableAnalysisPayload(liveAnalysis) ? liveAnalysis : readStoredAnalysisSnapshot()
  );
  const initialAnalysisSnapshot = initialAnalysisSnapshotRef.current;
  const initialPastDailyData = normalizeActualRows(
    initialAnalysisSnapshot?.past_sales_daily || initialAnalysisSnapshot?.past_sales || []
  );
  const initialPastWeeklyData = normalizeActualRows(initialAnalysisSnapshot?.past_sales_weekly || []);
  const initialForecastRawData = initialAnalysisSnapshot
    ? buildDailyForecastFromAnalysis(initialAnalysisSnapshot)
    : [];

  const [data, setData] = useState({ kpis: [], decisions: [], system_health: 0, predicted_risks: 0, forecasted_revenue: 0 });
  const [chartData, setChartData] = useState([]);
  const [pastDailyData, setPastDailyData] = useState(initialPastDailyData);
  const [pastWeeklyData, setPastWeeklyData] = useState(initialPastWeeklyData);
  const [forecastRawData, setForecastRawData] = useState(initialForecastRawData);
  const [analysis, setAnalysis] = useState(initialAnalysisSnapshot);
  const [loading, setLoading] = useState(!initialAnalysisSnapshot);
  const [forecastMode, setForecastMode] = useState('past');
  const [selectedClientForModal, setSelectedClientForModal] = useState(null);
  const [forecastViewMode, setForecastViewMode] = useState('chart');
  const [timeGranularity, setTimeGranularity] = useState('month');
  const [selectedDay, setSelectedDay] = useState(toIsoDay(new Date()));
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [selectedYear, setSelectedYear] = useState(String(new Date().getFullYear()));
  const [showTrends, setShowTrends] = useState(false);
  const [showAllTrends, setShowAllTrends] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedCustomerTrend, setSelectedCustomerTrend] = useState(null);
  const [expandedCard, setExpandedCard] = useState(null);
  const [salesModalView, setSalesModalView] = useState('both');
  const hasUserSelectedForecastModeRef = useRef(false);
  const backgroundBackfillStartedRef = useRef(false);
  const timeoutInfoShownRef = useRef(false);
  const forecastCacheRef = useRef({ fetchedAt: 0, pending: false, retryAfter: 0 });

  const availableMonths = useMemo(() => {
    const months = new Set();
    [...pastDailyData, ...forecastRawData].forEach((row) => {
      const date = parseDate(row?.date || row?.period || row?.name);
      if (date) months.add(toInputMonth(date));
    });
    return Array.from(months).sort().reverse();
  }, [pastDailyData, forecastRawData]);

  const availableDays = useMemo(() => {
    const days = new Set();
    [...pastDailyData, ...forecastRawData].forEach((row) => {
      const date = parseDate(row?.date || row?.period || row?.name);
      if (date) days.add(toIsoDay(date));
    });
    return Array.from(days).sort().reverse();
  }, [pastDailyData, forecastRawData]);

  useEffect(() => {
    if (availableMonths.length > 0 && !availableMonths.includes(selectedMonth)) {
      setSelectedMonth(availableMonths[0]);
    }
  }, [availableMonths]);

  useEffect(() => {
    if (availableDays.length > 0 && !availableDays.includes(selectedDay)) {
      setSelectedDay(availableDays[0]);
    }
  }, [availableDays]);

  const availableYears = useMemo(() => {
    const years = new Set([new Date().getFullYear()]);
    [...pastDailyData, ...pastWeeklyData, ...forecastRawData].forEach((row) => {
      const d = parseDate(row?.date || row?.period || row?.name);
      if (d) years.add(d.getFullYear());
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [pastDailyData, pastWeeklyData, forecastRawData]);

  const displayPastData = useMemo(() => {
    const sourceRows = pastDailyData.length ? pastDailyData : pastWeeklyData;
    const filteredRows = filterRowsByGranularity(
      sourceRows,
      timeGranularity,
      selectedDay,
      selectedMonth,
      selectedYear
    );

    const normalized = normalizeActualRows(filteredRows);
    if (timeGranularity === 'year') {
      return aggregateMonthly(normalized, { valueKeys: ['actual'], mode: 'sum' });
    }
    return normalized;
  }, [pastDailyData, pastWeeklyData, timeGranularity, selectedDay, selectedMonth, selectedYear]);

  const displayForecastData = useMemo(() => {
    const filteredRows = filterRowsByGranularity(
      forecastRawData,
      timeGranularity,
      selectedDay,
      selectedMonth,
      selectedYear
    );

    const normalized = normalizeForecastRows(filteredRows);
    if (timeGranularity === 'year') {
      return aggregateMonthly(normalized, { valueKeys: ['predicted', 'lower', 'upper'], mode: 'sum' });
    }
    return normalized;
  }, [forecastRawData, timeGranularity, selectedDay, selectedMonth, selectedYear]);

  const handleForecastModeChange = (mode) => {
    hasUserSelectedForecastModeRef.current = true;
    setForecastMode(mode);
  };

  const handleForecastModeToggle = () => {
    hasUserSelectedForecastModeRef.current = true;
    setForecastMode((prev) => (prev === 'past' ? 'present' : 'past'));
  };

  const ledgerRiskStats = useMemo(() => {
    // Master Rule: Prioritize the ledger-calculated summary from the context.
    // If the backend summary is present but we have an inventory model validation, 
    // it means the context has already calculated the 'Real' numbers.
    if (!analysis) return { out_of_stock: 0, low_stock: 0, deadstock: 0, overstock: 0, healthy: 0 };
    
    return {
      out_of_stock: Number(analysis.summary?.out_of_stock ?? 0),
      low_stock: Number(analysis.summary?.low_stock ?? 0),
      deadstock: Number(analysis.summary?.deadstock ?? 0),
      overstock: Number(analysis.summary?.overstock ?? 0),
      healthy: Number(analysis.summary?.healthy ?? 0),
    };
  }, [analysis]);

  const processCards = useMemo(() => [
    {
      title: 'Smart Data Upload',
      description: 'Easily upload and process your spreadsheets and business records.',
      icon: Database,
      status: 'Active',
      stats: { value: latestMeta?.status || 'Ready', label: 'System status' },
      color: 'blue',
      delay: 0.1,
      link: '/tasks'
    },
    {
      title: 'Predict Future Sales',
      description: 'See what will sell next based on AI data patterns.',
      icon: BrainCircuit,
      status: 'Ready',
      stats: { value: '94.2%', label: 'AI Accuracy' },
      color: 'purple',
      delay: 0.2,
      link: '/forecast'
    },
    {
      title: 'Low Stock Alerts',
      description: 'Keep track of items running out and get restock alerts.',
      icon: Package,
      status: 'Scan',
      stats: { value: ledgerRiskStats.low_stock || 0, label: 'Items to buy' },
      color: 'emerald',
      delay: 0.3,
      link: '/risks'
    },
    {
      title: 'Customer Trends',
      description: 'Understand buyer behavior and keep your top clients happy.',
      icon: Users,
      status: 'Watching',
      stats: { value: (analysis?.customers || []).length, label: 'Active Buyers' },
      color: 'amber',
      delay: 0.4,
      link: '/clients'
    }
  ], [latestMeta, analysis]);

  const isAnalyzing = Boolean(latestMeta?.uploadId) &&
    (latestMeta?.status === 'UPLOADING' || latestMeta?.status === 'PROCESSING' || latestMeta?.status === 'ANALYZING');

  const liveAnalysisKey = `${liveAnalysis?.analysis_isolation?.session_id || 'none'}:${liveAnalysis?.confidence_score ?? 'na'}:${liveAnalysis?.sales_summary?.total_sales ?? 'na'}:${liveAnalysis?.stock_analysis?.low_stock_items ?? 'na'}`;

  const hasUsableLiveAnalysis = hasUsableAnalysisPayload(liveAnalysis);

  const applyDashboardAnalysis = (analysisPayload) => {
    timeoutInfoShownRef.current = false;
    setData((prev) => ({ ...prev, decisions: [] }));
    setAnalysis(analysisPayload);

    const pastDaily = normalizeActualRows(
      analysisPayload?.past_sales_daily || analysisPayload?.past_sales || []
    );
    const pastWeekly = normalizeActualRows(analysisPayload?.past_sales_weekly || []);
    const forecastChart = buildDailyForecastFromAnalysis(analysisPayload);
    setPastDailyData(pastDaily);
    setPastWeeklyData(pastWeekly);
    setForecastRawData(forecastChart);
    setChartData([]);
  };

  useEffect(() => {
    fetchDashboardData({ showLoader: !hasUsableLiveAnalysis && !initialAnalysisSnapshot, preferLive: true });
  }, []);

  useEffect(() => {
    if (!latestMeta?.uploadId && !liveAnalysis) return;
    fetchDashboardData({ showLoader: false, preferLive: true });
  }, [latestMeta?.uploadId, latestMeta?.status, liveAnalysisKey]);

  useEffect(() => {
    if (!analysis) return;
    if (hasUserSelectedForecastModeRef.current) return;

    const hasPast = (
      pastDailyData.length > 0
      || pastWeeklyData.length > 0
      || (Array.isArray(analysis?.past_sales_daily) && analysis.past_sales_daily.length > 0)
      || (Array.isArray(analysis?.past_sales_weekly) && analysis.past_sales_weekly.length > 0)
      || (Array.isArray(analysis?.past_sales) && analysis.past_sales.length > 0)
    );
    const hasForecast = (
      (Array.isArray(analysis?.demand_forecast) && analysis.demand_forecast.length > 0)
      || (Array.isArray(analysis?.forecast?.next_365_days) && analysis.forecast.next_365_days.length > 0)
    );
    if (!hasPast && hasForecast && forecastMode === 'past') {
      setForecastMode('present');
    }
  }, [analysis, forecastMode, pastDailyData, pastWeeklyData]);

  const displayForecastDataForHorizon = useMemo(() => {
    if (!Array.isArray(displayForecastData)) return [];
    const sliceCount = 12;
    return displayForecastData.slice(0, sliceCount);
  }, [displayForecastData]);

  const salesModalTrendData = useMemo(() => {
    const pastRows = (displayPastData || []).slice(-24).map((row) => ({
      period: String(row.period || ''),
      pastUnits: Number(row.actual || 0),
      forecastUnits: null,
    })).filter((row) => row.period);

    const futureRows = (displayForecastData || []).slice(0, 24).map((row) => ({
      period: String(row.period || ''),
      pastUnits: null,
      forecastUnits: Number(row.predicted || 0),
    })).filter((row) => row.period);

    if (salesModalView === 'past') return pastRows;
    if (salesModalView === 'future') return futureRows;

    const merged = [];
    const byPeriod = new Map();

    [...pastRows, ...futureRows].forEach((row) => {
      if (!byPeriod.has(row.period)) {
        byPeriod.set(row.period, {
          period: row.period,
          pastUnits: null,
          forecastUnits: null,
        });
        merged.push(byPeriod.get(row.period));
      }
      const entry = byPeriod.get(row.period);
      if (row.pastUnits != null) entry.pastUnits = row.pastUnits;
      if (row.forecastUnits != null) entry.forecastUnits = row.forecastUnits;
    });

    return merged.sort((a, b) => {
      const aDate = parseDate(a.period);
      const bDate = parseDate(b.period);
      if (!aDate && !bDate) return 0;
      if (!aDate) return 1;
      if (!bDate) return -1;
      return aDate - bDate;
    });
  }, [displayPastData, displayForecastData, salesModalView]);

  const modalPastPoints = useMemo(() => {
    const sourceRows = Array.isArray(pastDailyData) && pastDailyData.length > 0
      ? pastDailyData
      : (Array.isArray(displayPastData) ? displayPastData : []);
    const baseDate = toStartOfDay(new Date());

    return sourceRows
      .map((row, idx) => {
        const rawDate = row?.date || row?.period || row?.name;
        const parsedDate = parseTimelineDate(rawDate, idx, baseDate);
        const value = Number(row?.actual ?? row?.value ?? row?.sales ?? 0);
        return {
          date: parsedDate,
          dateLabel: rawDate ? String(rawDate) : 'N/A',
          value: Number.isFinite(value) ? value : 0,
        };
      })
      .filter((p) => Number.isFinite(p.value) && p.date)
      .sort((a, b) => a.date - b.date);
  }, [pastDailyData, displayPastData]);

  const modalFuturePoints = useMemo(() => {
    const sourceRows = Array.isArray(forecastRawData) && forecastRawData.length > 0
      ? forecastRawData
      : (Array.isArray(displayForecastData) ? displayForecastData : []);
    const baseDate = toStartOfDay(new Date());

    return sourceRows
      .map((row, idx) => {
        const rawDate = row?.date || row?.period || row?.name;
        const parsedDate = parseTimelineDate(rawDate, idx, baseDate);
        const value = Number(row?.predicted ?? row?.predicted_demand ?? row?.value ?? 0);
        return {
          date: parsedDate,
          dateLabel: rawDate ? String(rawDate) : 'N/A',
          value: Number.isFinite(value) ? value : 0,
        };
      })
      .filter((p) => Number.isFinite(p.value) && p.date)
      .sort((a, b) => a.date - b.date);
  }, [forecastRawData, displayForecastData]);

  const mainSalesExecutiveCards = useMemo(() => {
    const pastPoints = (displayPastData || [])
      .map((row) => {
        const date = parseDate(row?.period || row?.name || row?.date);
        return {
          date,
          value: Number(row?.actual ?? row?.value ?? 0),
        };
      })
      .filter((p) => p.date && Number.isFinite(p.value));

    const futurePoints = (displayForecastDataForHorizon || [])
      .map((row) => {
        const date = parseDate(row?.period || row?.name || row?.date);
        return {
          date,
          value: Number(row?.predicted ?? row?.value ?? 0),
        };
      })
      .filter((p) => p.date && Number.isFinite(p.value));

    const activePoints = forecastMode === 'past'
      ? pastPoints
      : futurePoints;

    if (!activePoints.length) return [];

    const coverageStart = activePoints[0];
    const coverageEnd = activePoints[activePoints.length - 1];
    const peak = activePoints.reduce((acc, p) => (p.value > acc.value ? p : acc), activePoints[0]);
    const latest = activePoints[activePoints.length - 1];
    const avgValue = activePoints.reduce((sum, p) => sum + p.value, 0) / activePoints.length;

    const cards = [
      {
        title: 'Active Scope',
        value: forecastMode === 'past' ? 'Historical Only' : 'Forecast Only',
        sub: `${coverageStart.date.toLocaleDateString('en-GB')} to ${coverageEnd.date.toLocaleDateString('en-GB')}`,
        tint: 'emerald',
      },
      {
        title: 'Peak Volume',
        value: `${Math.round(peak.value).toLocaleString()} units`,
        sub: peak.date.toLocaleDateString('en-GB'),
        tint: 'blue',
      },
      {
        title: 'Average Volume',
        value: `${Math.round(avgValue).toLocaleString()} units`,
        sub: `${activePoints.length} data points`,
        tint: 'violet',
      },
      {
        title: 'Latest Point',
        value: `${Math.round(latest.value).toLocaleString()} units`,
        sub: latest.date.toLocaleDateString('en-GB'),
        tint: 'slate',
      },
    ];

    if (forecastMode === 'present' && futurePoints.length > 0) {
      const nextForecast = futurePoints[0];
      cards[3] = {
        title: 'Next Forecast',
        value: `${Math.round(nextForecast.value).toLocaleString()} units`,
        sub: nextForecast.date.toLocaleDateString('en-GB'),
        tint: 'slate',
      };
    }

    return cards;
  }, [displayPastData, displayForecastDataForHorizon, forecastMode]);

  useEffect(() => {
    setSalesModalView(forecastMode === 'past' ? 'past' : 'future');
  }, [forecastMode]);

  const hasAnySalesInsightData = (modalPastPoints.length + modalFuturePoints.length) > 0;

  const findRecentUsableAnalysis = async () => {
    try {
      const uploadsRes = await getWithTimeout('/ingestion/uploads-list/?limit=60', 5000);
      const uploads = Array.isArray(uploadsRes?.data) ? uploadsRes.data : [];

      // Keep this lightweight: list endpoint does not need embedded analysis blobs.
      const terminalCandidates = uploads.filter((row) => {
        const status = String(row?.analysis_status || '').toUpperCase();
        return status === 'COMPLETED' || status === 'SUCCESS';
      });

      const candidateIds = terminalCandidates
        .slice(0, 6)
        .map((candidate) => Number(candidate?.id))
        .filter((id) => Number.isFinite(id) && id > 0);

      const candidateFetches = candidateIds.map(async (uploadId) => {
        try {
          const uploadRes = await getWithTimeout(`/ingestion/upload-analysis/${uploadId}/`, 4500);
          const uploadPayload = uploadRes?.data || null;
          if (uploadPayload?.analysis) return uploadPayload.analysis;
          return buildFallbackAnalysisFromLatestPayload(uploadPayload || {});
        } catch {
          return null;
        }
      });

      const settled = await Promise.allSettled(candidateFetches);
      for (const row of settled) {
        if (row.status === 'fulfilled' && row.value) return row.value;
      }
    } catch {
      // If uploads-list fails, keep existing fallback path.
    }

    return null;
  };

  const refreshAdvancedForecast = async () => {
    const now = Date.now();
    if (forecastCacheRef.current.pending) return;
    if ((now - forecastCacheRef.current.fetchedAt) < DASHBOARD_FORECAST_CACHE_TTL_MS) return;
    if (now < (forecastCacheRef.current.retryAfter || 0)) return;

    forecastCacheRef.current.pending = true;
    try {
      const advForecastRes = await getWithTimeout('/ai/forecast/?days=365', DASHBOARD_FORECAST_TIMEOUT_MS);
      if (advForecastRes?.data) {
        const { historical, forecast } = advForecastRes.data;

        if (Array.isArray(historical)) {
          setPastDailyData(historical.map((d) => ({
            date: d.date,
            actual: d.value,
          })));
        }

        if (Array.isArray(forecast)) {
          setForecastRawData(forecast.map((d) => ({
            date: d.date,
            predicted: d.value,
            lower: d.lower,
            upper: d.upper,
          })));
        }
      }
      forecastCacheRef.current.fetchedAt = now;
    } catch (advErr) {
      forecastCacheRef.current.retryAfter = now + DASHBOARD_FORECAST_RETRY_COOLDOWN_MS;
      if (!isTimeoutError(advErr)) {
        console.error('Failed to fetch advanced forecast:', advErr);
      }
    } finally {
      forecastCacheRef.current.pending = false;
    }
  };

  const fetchDashboardData = async ({ showLoader = false, preferLive = true } = {}) => {
    try {
      if (showLoader) setLoading(true);

      // Run expensive forecast in background so initial dashboard paint is never blocked.
      refreshAdvancedForecast();

      let analysisPayload = preferLive ? (liveAnalysis || null) : null;
      let latestPayload = null;

      if (analysisPayload && hasUsableLiveAnalysis) {
        applyDashboardAnalysis(analysisPayload);
        if (showLoader) setLoading(false);
      }

      if (!analysisPayload) {
        try {
          const latestRes = await fetchLatestAnalysisWithRetry(showLoader ? 7000 : 11000);
          latestPayload = latestRes?.data || null;
          analysisPayload = latestRes?.data?.analysis || null;
        } catch (latestErr) {
          analysisPayload = null;
          latestPayload = null;
        }
      }

      if (!analysisPayload && latestPayload) {
        analysisPayload = buildFallbackAnalysisFromLatestPayload(latestPayload);
      }

      if (!analysisPayload) {
        if (showLoader) {
          // Do not block first paint on deep historical scans.
          if (!backgroundBackfillStartedRef.current) {
            backgroundBackfillStartedRef.current = true;
            setTimeout(() => {
              fetchDashboardData({ showLoader: false, preferLive: false });
            }, 0);
          }
        } else {
          try {
            analysisPayload = await withTimeout(findRecentUsableAnalysis(), 9000);
          } catch {
            analysisPayload = null;
          }
        }
      }

      if (analysisPayload) {
        // Master Rule: If the context is already locked (sticky), do NOT overwrite it 
        // with a background fetch unless the fetch is for a specific upload ID we just asked for.
        if (isLocked && hasUsableLiveAnalysis) {
          return;
        }

        applyDashboardAnalysis(analysisPayload);
        return;
      }

      // If we already have an analysis in view, do NOT clear it just because a background refresh failed.
      if (liveAnalysis) {
        if (showLoader) setLoading(false);
        return;
      }

      let decisions = [];
      try {
        const decisionRes = await getWithTimeout('/ai/decisions/', 5000);
        decisions = Array.isArray(decisionRes?.data?.decisions) ? decisionRes.data.decisions : [];
      } catch (decisionErr) {
        decisions = [];
      }

      setData((prev) => ({ ...prev, kpis: [], decisions }));
      // setAnalysis(null); // REMOVED: Never clear analysis on network failure; keep sticky.
      setPastDailyData([]);
      setPastWeeklyData([]);
      setForecastRawData([]);
      setChartData([]);
    } catch (err) {
      if (isTimeoutError(err)) {
        if (!timeoutInfoShownRef.current) {
          timeoutInfoShownRef.current = true;
          console.info('Dashboard fetch is slow; using lightweight fallback state.');
        }
      } else {
        console.error('Failed to fetch dashboard data:', err);
      }
    } finally {
      if (showLoader) setLoading(false);
    }
  };

  const handleExecute = async (id) => {
    try {
      await api.post(`/inventory/recommendations/${id}/execute/`);
      fetchDashboardData({ showLoader: false, preferLive: true });
    } catch (err) {
      console.error('Failed to execute recommendation:', err);
    }
  };

  const handleRefreshData = async () => {
    setIsRefreshing(true);
    try {
      await fetchDashboardData({ showLoader: false, preferLive: true });
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleViewFullscreen = () => {
    enableFullscreen();
  };

  const closeFullscreen = () => {
    disableFullscreen();
  };

  const handleShareChart = () => {
    const shareData = {
      title: 'Sales Performance Analysis',
      text: 'Check out our real-time sales forecast analysis',
      url: window.location.href,
    };
    if (navigator.share) {
      navigator.share(shareData).catch(err => console.log('Share failed:', err));
    } else {
      navigator.clipboard.writeText(window.location.href);
      alert('Chart link copied!');
    }
  };

  const handleExportChart = () => {
    if (!displayForecastData || displayForecastData.length === 0) {
      alert('No data to export');
      return;
    }
    const csvContent = [
      ['Period', 'Predicted', 'Lower Bound', 'Upper Bound', 'Production'],
      ...displayForecastData.map((d) => [
        d.period,
        d.predicted ?? '',
        d.lower ?? '',
        d.upper ?? '',
        d.production ?? '',
      ])
    ].map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `sales-forecast-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const displayedDecisions = analysis
    ? [
      ...(analysis.alerts || []).map((alert, idx) => ({
        id: null,
        title: `${alert.title || alert.type || 'ALERT'}`,
        suggestion_text: alert.msg || alert.message || 'Review this alert',
        recommendation_type: (alert.severity || '').toUpperCase() === 'CRITICAL' ? 'CRITICAL' : 'WARNING',
        localKey: `alert-${idx}`,
      })),
      ...(analysis.products_analysis || []).filter(p => p.risk_level !== 'LOW').map((p, idx) => ({
        id: null,
        title: `Action: ${p.product}`,
        suggestion_text: p.what,
        recommendation_type: p.risk_level === 'HIGH' ? 'CRITICAL' : 'OPTIMIZATION',
        localKey: `product-action-${idx}`,
      })),
    ]
    : data.decisions.map((d, idx) => ({
      id: d.id,
      title: d.title || 'Recommendation',
      suggestion_text: d.explanation || d.action_details || d.title || 'Data not available',
      recommendation_type: d.action === 'BUY' ? 'WARNING' : (d.action === 'STOP' ? 'OPTIMIZATION' : 'CRITICAL'),
      localKey: `decision-${idx}`,
    }));

  const visibleDecisions = displayedDecisions;

  const currencyCode = useMemo(() => detectCurrencyCode(analysis), [analysis]);
  const formatCurrency = useMemo(() => {
    const formatter = new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currencyCode || 'INR',
      maximumFractionDigits: 0,
    });
    return (value) => formatter.format(Number(value || 0));
  }, [currencyCode]);

  const displayedKpis = analysis
    ? [
      {
        title: 'Total Stock',
        value: String(analysis.inventory_summary?.total_stock ?? 'N/A'),
        change: 'Consolidated Inventory Count',
        pos: true,
        color: 'var(--emerald)',
        icon: 'Package',
        status_percent: 100,
      },
      {
        title: 'Total Revenue',
        value: formatCurrency(analysis.inventory_summary?.total_revenue ?? 0),
        change: 'Calculated from all sessions',
        pos: true,
        color: 'var(--blue)',
        icon: 'TrendingUp',
        status_percent: 80,
      },
      {
        title: 'Units Sold',
        value: String(analysis.inventory_summary?.total_sales ?? 'N/A'),
        change: 'Total confirmed sales',
        pos: true,
        color: 'var(--rose)',
        icon: 'ShoppingCart',
        status_percent: 60,
      },
      {
        title: 'Total Products',
        value: String(analysis.inventory_summary?.total_products ?? analysis.products?.length ?? 'N/A'),
        change: 'SKUs analyzed in report',
        pos: true,
        color: 'var(--emerald)',
        icon: 'Zap',
        status_percent: 100,
      },
    ]
    : data.kpis;



  const riskPieData = useMemo(() => {
    return [
      { name: 'Out', value: ledgerRiskStats.out_of_stock, color: '#ef4444' },
      { name: 'Low', value: ledgerRiskStats.low_stock, color: '#f59e0b' },
      { name: 'Over', value: ledgerRiskStats.overstock, color: '#8b5cf6' },
      { name: 'Dead', value: ledgerRiskStats.deadstock, color: '#6366f1' },
      { name: 'Healthy', value: ledgerRiskStats.healthy, color: '#10b981' },
    ].filter((item) => item.value >= 0);
  }, [ledgerRiskStats]);

  const dashboardCustomers = useMemo(() => {
    if (!analysis || typeof analysis !== 'object') return [];

    const directCustomers = Array.isArray(analysis?.customers) ? analysis.customers : [];
    const customerAnalysis = Array.isArray(analysis?.customer_analysis)
      ? analysis.customer_analysis
      : (Array.isArray(analysis?.customer_analysis?.customers) ? analysis.customer_analysis.customers : []);
    const products = Array.isArray(analysis?.products)
      ? analysis.products
      : (Array.isArray(analysis?.products_analysis) ? analysis.products_analysis : []);
    const previewRowsFromSheets = (Array.isArray(analysis?.metadata?.sheet_previews) ? analysis.metadata.sheet_previews : [])
      .flatMap((p) => (Array.isArray(p?.rows) ? p.rows : []));

    const staged = [
      ...directCustomers,
      ...buildCustomersFromCustomerAnalysis(customerAnalysis),
      ...buildCustomersFromProducts(products),
      ...buildCustomersFromRows(previewRowsFromSheets),
    ];

    const lookup = buildCustomerLookupFromRows(previewRowsFromSheets);
    const byIdentity = new Map();

    staged.forEach((customer, idx) => {
      const identity = resolveCustomerIdentity(customer, lookup);
      const identityKey = [
        identity.idCandidate ? `id:${identity.idCandidate.toLowerCase()}` : '',
        identity.emailCandidate ? `mail:${identity.emailCandidate.toLowerCase()}` : '',
        identity.phoneCandidate ? `phone:${normalizePhoneKey(identity.phoneCandidate)}` : '',
        identity.resolvedName && identity.resolvedName !== 'Client Account' ? `name:${identity.resolvedName.toLowerCase()}` : '',
      ].find(Boolean) || `fallback:${idx}`;

      const normalized = {
        ...customer,
        customer_id: identity.idCandidate || customer?.customer_id || '',
        customer_name: identity.resolvedName,
        company: isMeaningfulText(customer?.company) ? customer.company : identity.resolvedName,
        email: identity.emailCandidate || customer?.email || null,
        phone: identity.phoneCandidate || customer?.phone || null,
        address: customer?.address || pickFromRow(customer, ADDRESS_KEYS) || null,
      };

      const existing = byIdentity.get(identityKey);
      byIdentity.set(identityKey, mergeCustomerRecord(existing, normalized));
    });

    return Array.from(byIdentity.values())
      .filter((c) => c && (isMeaningfulText(c.customer_name) || c.customer_id || c.email || c.phone))
      .sort((a, b) => toNum(b.total_purchase, 0) - toNum(a.total_purchase, 0));
  }, [analysis]);

  const customerTrendData = useMemo(() => {
    if (!dashboardCustomers.length) return [];
    const up = dashboardCustomers.filter((c) => deriveCustomerTrendKey(c) === 'up').length;
    const down = dashboardCustomers.filter((c) => deriveCustomerTrendKey(c) === 'down').length;
    const flat = dashboardCustomers.filter((c) => deriveCustomerTrendKey(c) === 'flat').length;
    return [
      { name: 'Growing', value: up },
      { name: 'Churn Risk', value: down },
      { name: 'Stable', value: flat },
    ];
  }, [dashboardCustomers]);

  const salesInsights = useMemo(() => {
    const scopeLabelByMode = {
      past: 'Past (Historical)',
      future: 'Future (Forecast)',
      both: 'Past + Future (Combined)',
    };

    const allPointsByMode = {
      past: modalPastPoints,
      future: modalFuturePoints,
      both: [...modalPastPoints, ...modalFuturePoints].sort((a, b) => a.date - b.date),
    };

    const preferred = allPointsByMode[salesModalView] || [];
    let activeMode = salesModalView;
    let points = preferred;

    if (!points.length) {
      if (allPointsByMode.both.length) {
        activeMode = 'both';
        points = allPointsByMode.both;
      } else if (allPointsByMode.past.length) {
        activeMode = 'past';
        points = allPointsByMode.past;
      } else if (allPointsByMode.future.length) {
        activeMode = 'future';
        points = allPointsByMode.future;
      }
    }

    if (points.length === 0) return null;

    const scopeLabel = activeMode === salesModalView
      ? scopeLabelByMode[activeMode]
      : `${scopeLabelByMode[activeMode]} (Auto-selected: ${scopeLabelByMode[salesModalView]} had no data)`;

    const peak = points.reduce((acc, p) => (p.value > acc.value ? p : acc), points[0]);
    const low = points.reduce((acc, p) => (p.value < acc.value ? p : acc), points[0]);
    const latest = points[points.length - 1];
    const first = points[0];

    const deltas = [];
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const curr = points[i];
      const delta = curr.value - prev.value;
      const deltaPct = prev.value > 0 ? (delta / prev.value) * 100 : 0;
      deltas.push({
        from: prev,
        to: curr,
        delta,
        deltaPct,
      });
    }

    const biggestRise = deltas.length
      ? deltas.reduce((acc, d) => (d.delta > acc.delta ? d : acc), deltas[0])
      : null;
    const biggestDrop = deltas.length
      ? deltas.reduce((acc, d) => (d.delta < acc.delta ? d : acc), deltas[0])
      : null;

    const values = points.map((p) => p.value);
    const mean = values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length);
    const variance = values.reduce((sum, v) => sum + ((v - mean) ** 2), 0) / Math.max(1, values.length);
    const stdDev = Math.sqrt(variance);
    const volatilityPct = mean > 0 ? (stdDev / mean) * 100 : 0;

    const recentWindow = points.slice(-7);
    const olderWindow = points.slice(-14, -7);
    const avgRecent = recentWindow.length ? (recentWindow.reduce((s, p) => s + p.value, 0) / recentWindow.length) : 0;
    const avgOlder = olderWindow.length ? (olderWindow.reduce((s, p) => s + p.value, 0) / olderWindow.length) : avgRecent;
    const trendDeltaPct = avgOlder > 0 ? ((avgRecent - avgOlder) / avgOlder) * 100 : 0;
    const trendLabel = trendDeltaPct > 8 ? 'Up Trend' : (trendDeltaPct < -8 ? 'Down Trend' : 'Stable Trend');

    const yearlyMap = new Map();
    points.forEach((p) => {
      const year = p.date.getFullYear();
      if (!yearlyMap.has(year)) {
        yearlyMap.set(year, { year, totalUnits: 0, points: 0, peak: p.value, low: p.value });
      }
      const y = yearlyMap.get(year);
      y.totalUnits += p.value;
      y.points += 1;
      y.peak = Math.max(y.peak, p.value);
      y.low = Math.min(y.low, p.value);
    });

    const yearlyBreakdown = Array.from(yearlyMap.values())
      .sort((a, b) => a.year - b.year)
      .map((y) => ({
        ...y,
        avgUnits: y.points > 0 ? y.totalUnits / y.points : 0,
      }));

    const timelineEvents = [
      {
        kind: 'PEAK',
        date: peak.date,
        dateLabel: peak.date.toLocaleDateString('en-GB'),
        year: peak.date.getFullYear(),
        message: `Peak sales reached ${Math.round(peak.value).toLocaleString()} units`,
      },
      {
        kind: 'LOWEST',
        date: low.date,
        dateLabel: low.date.toLocaleDateString('en-GB'),
        year: low.date.getFullYear(),
        message: `Lowest sales recorded at ${Math.round(low.value).toLocaleString()} units`,
      },
      biggestRise ? {
        kind: 'RISE',
        date: biggestRise.to.date,
        dateLabel: biggestRise.to.date.toLocaleDateString('en-GB'),
        year: biggestRise.to.date.getFullYear(),
        message: `Biggest rise: +${Math.round(biggestRise.delta).toLocaleString()} units (${biggestRise.deltaPct.toFixed(1)}%)`,
      } : null,
      biggestDrop ? {
        kind: 'DROP',
        date: biggestDrop.to.date,
        dateLabel: biggestDrop.to.date.toLocaleDateString('en-GB'),
        year: biggestDrop.to.date.getFullYear(),
        message: `Biggest drop: ${Math.round(biggestDrop.delta).toLocaleString()} units (${biggestDrop.deltaPct.toFixed(1)}%)`,
      } : null,
      {
        kind: 'LATEST',
        date: latest.date,
        dateLabel: latest.date.toLocaleDateString('en-GB'),
        year: latest.date.getFullYear(),
        message: `Latest data point: ${Math.round(latest.value).toLocaleString()} units`,
      },
    ].filter(Boolean).sort((a, b) => a.date - b.date);

    return {
      scopeLabel,
      mode: salesModalView,
      totalPoints: points.length,
      coverageStart: first,
      coverageEnd: latest,
      peak,
      low,
      latest,
      biggestRise,
      biggestDrop,
      mean,
      volatilityPct,
      trendLabel,
      trendDeltaPct,
      yearlyBreakdown,
      timelineEvents,
    };
  }, [salesModalView, modalPastPoints, modalFuturePoints]);


  // Health score animation: 0% -> 100% on initial load, then 0% if no analysis
  const [animatedHealth, setAnimatedHealth] = useState(0);
  const [hasAnimated, setHasAnimated] = useState(false);

  useEffect(() => {
    if (!hasAnimated && (!analysis || (typeof analysis === 'object' && Object.keys(analysis).length === 0))) {
      // Animate from 0 to 100
      let start = 0;
      const duration = 1200; // ms
      const step = 10;
      const increment = 100 / (duration / step);
      function animate() {
        start += increment;
        if (start < 100) {
          setAnimatedHealth(Math.round(start));
          setTimeout(animate, step);
        } else {
          setAnimatedHealth(100);
          setTimeout(() => {
            setAnimatedHealth(0);
            setHasAnimated(true);
          }, 600);
        }
      }
      animate();
    }
  }, [hasAnimated, analysis]);

  const derivedHealth = (() => {
    if (!analysis || (typeof analysis === 'object' && Object.keys(analysis).length === 0)) {
      return animatedHealth;
    }

    const confidenceScore = Number(analysis?.confidence_score ?? analysis?.confidenceScore ?? NaN);
    const confidenceFallback = Number.isFinite(confidenceScore)
      ? Math.max(0, Math.min(100, Math.round(confidenceScore)))
      : null;

    if (!ledgerRiskStats) {
      return confidenceFallback ?? (typeof data?.system_health === 'number' ? data.system_health : 0);
    }

    const out = Number(ledgerRiskStats.out_of_stock || 0);
    const low = Number(ledgerRiskStats.low_stock || 0);
    const over = Number(ledgerRiskStats.overstock || 0);
    const dead = Number(ledgerRiskStats.deadstock || 0);
    const healthy = Number(ledgerRiskStats.healthy || 0);
    const total = out + low + over + dead + healthy;
    if (!total) {
      return confidenceFallback ?? (data?.system_health ?? 0);
    }

    const stockHealth = Math.round((healthy / total) * 100);
    if (confidenceFallback === null) {
      return stockHealth;
    }

    const weighted = Math.round((stockHealth * 0.7) + (confidenceFallback * 0.3));
    return Math.max(0, Math.min(100, weighted));
  })();

  if (loading && !analysis) {
    return (
      <div className="flex flex-col items-center justify-center p-40 gap-6">
        <div className="relative">
          <div className="w-16 h-16 border-4 border-emerald-500/10 border-t-emerald-500 rounded-full animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center">
            <BrainCircuit className="text-emerald-500 animate-pulse" size={24} />
          </div>
        </div>
        <p className="text-xs font-bold tracking-widest text-emerald-500 uppercase">Loading your data...</p>
      </div>
    );
  }

  return (
    <>
      {/* Normal Dashboard View */}
      <div className="space-y-12 pb-20">
        {/* Master Cockpit Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3 py-1 text-[10px] font-black text-emerald-500 flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  AI Status: {analysis ? 'Connected' : 'Waiting for data'}
                </div>
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-full px-3 py-1 text-[10px] font-black text-blue-400">
                  Accuracy: {analysis ? `${String(analysis.confidence_score ?? 'N/A')} ${String(analysis.confidence_label ?? '')}` : 'Calculating...'}
                </div>
              </div>

                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-6 text-sm font-medium text-emerald-500 leading-relaxed">
                  Market demand is {analysis?.forecast_summary?.daily_pattern ? String(analysis.forecast_summary.daily_pattern).toLowerCase() : 'stable'}. {(analysis?.recommendations && analysis.recommendations[0]) || 'Your AI assistant is monitoring all sales trends closely.'}
                </div>
                <h1 className="text-5xl font-black text-[var(--text-main)] tracking-tighter leading-none mt-4 uppercase">
                  Business Control Center
                </h1>
                <p className="text-[var(--text-muted)] text-sm font-medium mt-3 max-w-lg">
                  Everything you need to run your business in one place. AI-powered stock alerts, sales predictions, and customer insights in real-time.
                </p>
            </motion.div>
          </div>

          <div className="glass-premium p-4 border-white/5 shadow-2xl rounded-3xl flex items-center gap-6 min-w-[320px]">
            <div className="relative w-16 h-16">
              <svg className="w-full h-full transform -rotate-90 drop-shadow-[0_0_8px_rgba(16,185,129,0.3)]">
                <circle cx="32" cy="32" r={HEALTH_CIRCLE_RADIUS} stroke="currentColor" strokeWidth="4" fill="transparent" className="text-white/5" />
                <motion.circle
                  cx="32" cy="32" r={HEALTH_CIRCLE_RADIUS} stroke="currentColor" strokeWidth="4" fill="transparent"
                  strokeDasharray={HEALTH_CIRCLE_CIRC}
                  initial={{ strokeDashoffset: HEALTH_CIRCLE_CIRC }}
                  animate={{ strokeDashoffset: HEALTH_CIRCLE_CIRC - ((derivedHealth || 0) / 100) * HEALTH_CIRCLE_CIRC }}
                  transition={{ duration: 1.5, ease: "easeOut" }}
                  className="text-emerald-500"
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-sm font-black text-white">{derivedHealth}%</span>
              </div>
            </div>
            <div>
              <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">System Health</div>
              <div className="text-xl font-black text-white">{derivedHealth > 70 ? 'Excellent' : derivedHealth > 40 ? 'Fair' : 'Critical'}</div>
              <div className="text-[10px] text-slate-400 font-bold mt-1">AI Confidence: {analysis?.confidence_label || 'High'}</div>
            </div>
          </div>
        </div>

        {/* Process Navigation Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {processCards.map((card, i) => (
            <ProcessCard
              key={i}
              {...card}
              onClick={() => {
                if (card.link) {
                  navigate(card.link);
                }
              }}
            />
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Demand Insights Section */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            <GlassCard className="!p-0 !border-slate-200/60 dark:!border-white/10 !bg-white dark:!bg-slate-900/40 overflow-visible shadow-xl">
              {/* AI Engine status bar */}
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
              </div>

              {/* Chart Section Header */}
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

              {/* Controls row */}
              <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-slate-200 bg-slate-50/60 p-2.5 mb-4 px-6 mx-6">
                <div className="inline-flex items-center rounded-xl border border-slate-200 bg-white p-1">
                  {['past', 'future', 'combined'].map((m) => (
                    <button
                      key={m}
                      onClick={() => setForecastMode(m)}
                      className={`px-3.5 py-2 rounded-lg text-[12px] font-medium capitalize transition-all duration-200 ${forecastMode === m ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                    >
                      {m}
                    </button>
                  ))}
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
                      className={`px-3 py-2 rounded-lg text-[12px] font-medium capitalize transition-all duration-200 ${timeGranularity === option ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
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
                      onClick={() => setForecastViewMode('chart')}
                      className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors ${forecastViewMode === 'chart' ? 'border-slate-900 bg-slate-900 text-white' : 'border-transparent text-slate-600 hover:bg-slate-100'}`}
                    >
                      <BarChart3 size={14} />
                      <span>Chart</span>
                    </button>
                    <button
                      onClick={() => setForecastViewMode('table')}
                      className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors ${forecastViewMode === 'table' ? 'border-slate-900 bg-slate-900 text-white' : 'border-transparent text-slate-600 hover:bg-slate-100'}`}
                    >
                      <ClipboardList size={14} />
                      <span>Table</span>
                    </button>
                  </div>
                  <button
                    onClick={() => setShowTrends(true)}
                    className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-slate-700 hover:bg-slate-100"
                  >
                    <TrendingUp size={14} />
                    Trends
                  </button>
                </div>
              </div>

              {/* Chart Content Area */}
              <div className="p-6">
                {forecastViewMode === 'chart' ? (
                  <div className="bg-gradient-to-br from-slate-50/50 dark:from-white/5 to-white dark:to-slate-900/20 rounded-2xl border border-slate-200/40 dark:border-white/10 overflow-hidden" style={{ minHeight: '500px' }}>
                    <PredictionChart
                      pastData={displayPastData}
                      forecastData={displayForecastData}
                      mode={forecastMode}
                      horizon={timeGranularity}
                      showLegend={false}
                      height={420}
                      isAnalyzing={isAnalyzing}
                    />
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm h-[500px] flex items-center justify-center text-slate-400">
                    Table view coming soon to Dashboard...
                  </div>
                )}
              </div>
            </GlassCard>

            {/* AI Pulse Sidebar */}
            <AIPulse />
          </div>

          {/* Action Center — 8 Professional Cards */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">Required Actions</span>
              </div>
              <span className="text-[10px] font-bold text-slate-400 tabular-nums">{displayedDecisions.length} found</span>
            </div>

            <div className="flex flex-col gap-2.5 max-h-[620px] overflow-y-auto pr-1 custom-scrollbar">
              {(() => {
                const hasLiveAnalysis = Boolean(analysis && ((analysis.products_analysis || []).length || (analysis.alerts || []).length));
                const CARD_STYLES = [
                  { gradient: 'from-rose-500/10 to-rose-500/[0.02]',   border: 'border-rose-500/20 hover:border-rose-500/40',   iconBg: 'bg-rose-500/15',   iconColor: 'text-rose-500',   numBg: 'bg-rose-500',   icon: AlertCircle,   priority: 'URGENT' },
                  { gradient: 'from-amber-500/10 to-amber-500/[0.02]', border: 'border-amber-500/20 hover:border-amber-500/40', iconBg: 'bg-amber-500/15', iconColor: 'text-amber-500', numBg: 'bg-amber-500', icon: AlertTriangle, priority: 'HIGH' },
                  { gradient: 'from-blue-500/10 to-blue-500/[0.02]',   border: 'border-blue-500/20 hover:border-blue-500/40',   iconBg: 'bg-blue-500/15',   iconColor: 'text-blue-500',   numBg: 'bg-blue-500',   icon: Zap,          priority: 'MEDIUM' },
                  { gradient: 'from-indigo-500/10 to-indigo-500/[0.02]', border: 'border-indigo-500/20 hover:border-indigo-500/40', iconBg: 'bg-indigo-500/15', iconColor: 'text-indigo-500', numBg: 'bg-indigo-500', icon: TrendingUp, priority: 'INSIGHT' },
                  { gradient: 'from-violet-500/10 to-violet-500/[0.02]', border: 'border-violet-500/20 hover:border-violet-500/40', iconBg: 'bg-violet-500/15', iconColor: 'text-violet-500', numBg: 'bg-violet-500', icon: ShoppingCart, priority: 'PLAN' },
                  { gradient: 'from-cyan-500/10 to-cyan-500/[0.02]',   border: 'border-cyan-500/20 hover:border-cyan-500/40',   iconBg: 'bg-cyan-500/15',   iconColor: 'text-cyan-500',   numBg: 'bg-cyan-500',   icon: BarChart3,    priority: 'REVIEW' },
                  { gradient: 'from-emerald-500/10 to-emerald-500/[0.02]', border: 'border-emerald-500/20 hover:border-emerald-500/40', iconBg: 'bg-emerald-500/15', iconColor: 'text-emerald-500', numBg: 'bg-emerald-500', icon: CheckCircle2, priority: 'GOOD' },
                  { gradient: 'from-teal-500/10 to-teal-500/[0.02]',   border: 'border-teal-500/20 hover:border-teal-500/40',   iconBg: 'bg-teal-500/15',   iconColor: 'text-teal-500',   numBg: 'bg-teal-500',   icon: ShieldCheck,  priority: 'SAFE' },
                ];

                const TYPE_STYLE_MAP = { CRITICAL: 0, WARNING: 1, OPTIMIZATION: 2, SCANNING: 3 };

                const realCards = displayedDecisions.slice(0, 8);
                const paddedCards = realCards.map((d) => ({ ...d, isReal: true }));

                if (hasLiveAnalysis && paddedCards.length === 0) {
                  return (
                    <div className="rounded-2xl border border-slate-200/60 dark:border-white/10 p-5 text-xs font-bold text-slate-500 dark:text-slate-400 bg-white/60 dark:bg-white/5">
                      No immediate actions in current analysis.
                    </div>
                  );
                }

                return paddedCards.map((d, i) => {
                  const styleIdx = d.isReal ? (TYPE_STYLE_MAP[d.recommendation_type] ?? i % CARD_STYLES.length) : ((realCards.length + i) % CARD_STYLES.length);
                  const s = CARD_STYLES[styleIdx % CARD_STYLES.length];
                  const Icon = d.isReal
                    ? ({ CRITICAL: AlertCircle, WARNING: ShoppingCart, OPTIMIZATION: Zap }[d.recommendation_type] || s.icon)
                    : s.icon;

                  return (
                    <motion.div
                      key={d.id || d.localKey || `card-${i}`}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.06 }}
                      className={`group relative rounded-2xl border bg-gradient-to-r ${s.gradient} ${s.border} p-3.5 flex items-center gap-3.5 cursor-pointer transition-all duration-300 hover:shadow-md hover:scale-[1.015]`}
                      onClick={() => d.id ? handleExecute(d.id) : null}
                    >
                      {/* Number badge */}
                      <div className={`absolute -top-1.5 -left-1.5 w-5 h-5 ${s.numBg} rounded-full flex items-center justify-center shadow-lg z-10`}>
                        <span className="text-[9px] font-black text-white">{i + 1}</span>
                      </div>

                      {/* Icon */}
                      <div className={`w-9 h-9 rounded-xl ${s.iconBg} flex items-center justify-center shrink-0`}>
                        <Icon size={16} className={s.iconColor} />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-[11px] font-bold text-slate-900 dark:text-white truncate leading-tight">{d.title}</span>
                          <span className={`text-[8px] font-black px-1.5 py-0.5 rounded ${s.iconBg} ${s.iconColor} uppercase tracking-wide shrink-0`}>{s.priority}</span>
                        </div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium leading-snug line-clamp-1">{d.suggestion_text}</p>
                      </div>

                      {/* Arrow */}
                      <ChevronRight size={14} className="text-slate-300 dark:text-slate-600 group-hover:text-slate-500 dark:group-hover:text-slate-300 transition-colors shrink-0" />
                    </motion.div>
                  );
                });
              })()}
            </div>

            {/* Footer link */}
            <Link
              to="/tasks"
              className="flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-opacity shadow-lg"
            >
              View Full Action Plan
              <ArrowRight size={12} />
            </Link>
          </div>
        </div>

        {/* KPI Prediction Matrix */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {displayedKpis.map((kpi, i) => {
            const Icon = ICON_MAP[kpi.icon] || TrendingUp;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 + i * 0.1 }}
              >
                <GlassCard className="!p-6 hover:!border-white/20">
                  <div className="flex justify-between items-start mb-4">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-white/[0.03] border border-white/5" style={{ color: kpi.color }}>
                      <Icon size={24} />
                    </div>
                    <div className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-tighter ${kpi.pos ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                      {kpi.change}
                    </div>
                  </div>
                  <div className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest mb-1">{kpi.title}</div>
                  <div className="text-2xl font-black text-[var(--text-main)] tracking-tight">{kpi.value}</div>
                  <div className="w-full h-1 bg-white/5 rounded-full mt-4 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${kpi.status_percent}%` }}
                      className="h-full"
                      style={{ background: kpi.color }}
                    />
                  </div>
                </GlassCard>
              </motion.div>
            );
          })}
        </div>

        {analysis && (
          <div className="space-y-6">
            {/* Row 1: Inventory Risk Distribution - Master Edition (Full Width) */}
            <div className="grid grid-cols-1 gap-6">
              <GlassCard className="!p-0 !border-slate-200/60 dark:!border-white/10 !bg-white dark:!bg-slate-900/40 overflow-hidden shadow-2xl hover:shadow-[0_20px_50px_rgba(0,0,0,0.1)] dark:hover:shadow-[0_20px_50px_rgba(0,0,0,0.3)] transition-all duration-500">
                <div className="px-8 py-6 border-b border-slate-200/40 dark:border-white/10 bg-gradient-to-r from-indigo-50/50 dark:from-indigo-500/10 to-transparent flex items-center justify-between">
                  <div>
                    <h3 className="text-[14px] font-black text-slate-900 dark:text-white uppercase tracking-[0.2em]">
                      Inventory Risk Distribution
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-widest">Real-time Ledger Sync</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setExpandedCard('inventory')}
                      className="p-2.5 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 transition-all hover:scale-110 active:scale-95 shadow-sm"
                      title="Expand view"
                    >
                      <Eye size={20} />
                    </button>
                  </div>
                </div>
                
                <div className="p-8 space-y-8">
                  <div className="flex flex-col lg:flex-row items-center gap-12">
                    <div className="w-full lg:w-1/2">
                      <ChartMountContainer className="h-[280px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={riskPieData}
                              dataKey="value"
                              nameKey="name"
                              innerRadius={70}
                              outerRadius={110}
                              paddingAngle={4}
                              stroke="none"
                            >
                              {riskPieData.map((entry, index) => (
                                <Cell 
                                  key={entry.name} 
                                  fill={entry.color} 
                                  className="hover:opacity-80 transition-opacity cursor-pointer focus:outline-none"
                                />
                              ))}
                            </Pie>
                            <Tooltip
                              formatter={(value) => [`${value.toLocaleString()} items`, 'Count']}
                              contentStyle={{
                                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                                backdropFilter: 'blur(10px)',
                                border: 'none',
                                borderRadius: '16px',
                                boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
                                fontSize: '12px',
                                fontWeight: '900',
                                padding: '12px 16px'
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </ChartMountContainer>
                    </div>

                    <div className="w-full lg:w-1/2 grid grid-cols-2 lg:grid-cols-5 gap-4">
                      {riskPieData.map((item) => (
                        <div 
                          key={item.name} 
                          className="group p-5 rounded-3xl bg-slate-50/50 dark:bg-white/5 hover:bg-white dark:hover:bg-white/10 transition-all duration-300 border border-slate-200/50 dark:border-white/5 hover:border-indigo-500/30 hover:shadow-xl hover:-translate-y-1"
                        >
                          <div className="flex items-center justify-between mb-3">
                            <div className="w-3 h-3 rounded-full shadow-lg" style={{ backgroundColor: item.color }} />
                            <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{item.name}</span>
                          </div>
                          <div className="flex items-baseline gap-1">
                            <p className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{item.value}</p>
                            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">units</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </GlassCard>
            </div>

            {/* Row 2: Insights & Growth (2 Columns) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">


            {/* Retention Risk Alerts - Professional */}
            <GlassCard className="!p-0 !border-slate-200/60 dark:!border-white/10 !bg-white dark:!bg-slate-900/40 overflow-hidden shadow-lg hover:shadow-xl transition-shadow">
              <div className="px-6 py-5 border-b border-slate-200/40 dark:border-white/10 bg-gradient-to-r from-rose-50 dark:from-rose-500/10 to-transparent flex items-center justify-between">
                <div>
                  <h3 className="text-[12px] font-black text-slate-900 dark:text-white uppercase tracking-widest">
                    Retention Risk Alerts
                  </h3>
                  <p className="text-[9px] text-slate-500 dark:text-slate-400 font-bold mt-0.5">Customers requiring attention</p>
                </div>
                <button
                  onClick={() => setExpandedCard('retention')}
                  className="p-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 transition-all hover:scale-110"
                  title="Expand view"
                >
                  <Eye size={18} />
                </button>
              </div>
              <div className="p-5 space-y-3" style={{ maxHeight: '550px', overflowY: 'auto', scrollBehavior: 'smooth' }}>
                {!dashboardCustomers.length || dashboardCustomers.filter(c => RETENTION_LEVELS.includes(c.intensity_level)).length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-24 opacity-30">
                    <ShieldCheck size={36} className="mb-4 text-emerald-500" />
                    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-700 dark:text-slate-300">All Cycles Verified</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-2">Zero cycle-deviations detected</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {dashboardCustomers
                      .filter(c => RETENTION_LEVELS.includes(c.intensity_level))
                      .sort((a, b) => {
                        // Prioritize MIXED_PERFORMANCE at the top
                        if (a.intensity_level === 'MIXED_PERFORMANCE' && b.intensity_level !== 'MIXED_PERFORMANCE') return -1;
                        if (a.intensity_level !== 'MIXED_PERFORMANCE' && b.intensity_level === 'MIXED_PERFORMANCE') return 1;
                        return b.total_purchase - a.total_purchase;
                      })
                      .map((c, i) => {
                      const level = c.intensity_level || 'MINOR_DROP';
                      const theme =
                        (level === 'NOT_PURCHASED' || level === 'LIYA_HI_NAHI') ? {
                          bg: 'bg-red-50/80 dark:bg-red-500/10',
                          border: 'border-red-200 dark:border-red-500/30',
                          text: 'text-red-600 dark:text-red-400',
                          accent: 'bg-red-600',
                          status: c.reason || 'Missed 30d+ Deadline'
                        } :
                          level === 'MIXED_PERFORMANCE' ? {
                            bg: 'bg-blue-50/50 dark:bg-blue-500/10',
                            border: 'border-blue-200/60 dark:border-blue-500/20',
                            text: 'text-blue-600 dark:text-blue-400',
                            accent: 'bg-blue-500',
                            status: c.reason || 'Mixed Portfolio Trend'
                          } :
                          (level === 'MAJOR_DROP' || level === 'BAHUT_KAM') ? {
                            bg: 'bg-orange-50/50 dark:bg-orange-500/10',
                            border: 'border-orange-200/60 dark:border-orange-500/20',
                            text: 'text-orange-600 dark:text-orange-400',
                            accent: 'bg-orange-500',
                            status: c.reason || 'Missed Month-End Deadline'
                          } :
                            level === 'NEW_CUSTOMER' ? {
                              bg: 'bg-emerald-50/50 dark:bg-emerald-500/10',
                              border: 'border-emerald-200/60 dark:border-emerald-500/20',
                              text: 'text-emerald-600 dark:text-emerald-400',
                              accent: 'bg-emerald-500',
                              status: c.reason || 'New Customer (First Time)'
                            } :
                              {
                                bg: 'bg-amber-50/40 dark:bg-amber-500/10',
                                border: 'border-amber-200/60 dark:border-amber-500/20',
                                text: 'text-amber-600 dark:text-amber-400',
                                accent: 'bg-amber-500',
                                status: c.reason || 'Minor Trend Change'
                              };

                      return (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, x: -15 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.05 }}
                          className={`p-5 rounded-3xl ${theme.bg} border ${theme.border} hover:shadow-xl transition-all duration-300 group relative overflow-hidden`}
                        >
                          <div className={`absolute top-0 left-0 bottom-0 w-1.5 ${theme.accent} opacity-40`} />

                          <div className="flex justify-between items-start gap-3 mb-4 relative z-10">
                            <div className="flex items-center gap-4 min-w-0">
                              <div className={`w-10 h-10 rounded-xl ${theme.bg} border ${theme.border} flex items-center justify-center`}>
                                <Users size={18} className={theme.text} />
                              </div>
                                <div className="min-w-0">
                                  <h4 className="text-[13px] font-black text-slate-900 dark:text-white truncate uppercase tracking-tight leading-none group-hover:text-blue-500 transition-colors">
                                    {getCustomerDisplayName(c)}
                                  </h4>
                                  <div className="flex items-center gap-2 mt-2">
                                    <div className={`w-1.5 h-1.5 rounded-full ${theme.accent} animate-pulse`} />
                                    <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">Buyer: {getCustomerSubtitle(c, getCustomerDisplayName(c))}</span>
                                  </div>
                                </div>
                              </div>
                              <div className={`shrink-0 ${theme.bg} ${theme.text} px-3 py-1 rounded-lg text-[8px] font-black uppercase border ${theme.border} shadow-sm group-hover:scale-105 transition-transform`}>
                                {c.intensity_label}
                              </div>
                            </div>

                            {/* Professional Detail Block */}
                            <div className="grid grid-cols-2 gap-2 mb-5 px-1">
                               <div className="flex flex-col p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-white/10 group-hover:border-blue-200 transition-colors shadow-sm">
                                 <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-1.5"><Mail size={12} className="text-blue-500"/> Email</span>
                                 <span className="text-[11px] text-slate-700 dark:text-slate-300 font-bold truncate group-hover:text-blue-600 transition-colors">{getFieldFallback(c.email)}</span>
                               </div>
                               <div className="flex flex-col p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-white/10 group-hover:border-emerald-200 transition-colors shadow-sm">
                                 <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-1.5"><Phone size={12} className="text-emerald-500"/> Phone</span>
                                 <span className="text-[11px] text-slate-700 dark:text-slate-300 font-bold truncate group-hover:text-emerald-600 transition-colors">{getFieldFallback(c.phone)}</span>
                               </div>
                               <div className="col-span-2 flex flex-col p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-white/10 group-hover:border-amber-200 transition-colors shadow-sm">
                                 <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-1.5"><MapPin size={12} className="text-amber-500"/> Address</span>
                                 <span className="text-[11px] text-slate-700 dark:text-slate-300 font-bold truncate group-hover:text-amber-600 transition-colors">{getFieldFallback(c.address)}</span>
                               </div>
                            </div>



                          <button 
                            onClick={() => setSelectedClientForModal(c)}
                            className={`w-full py-2.5 rounded-2xl ${theme.bg} border ${theme.border} ${theme.text} text-[9px] font-black uppercase tracking-[0.2em] flex items-center justify-center gap-2 hover:brightness-95 active:scale-95 transition-all`}
                          >
                            Take Action
                            <ArrowUpRight size={14} />
                          </button>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </div>
            </GlassCard>

            {/* Customer Growth vs Churn - Professional */}
            <GlassCard className="!p-0 !border-slate-200/60 dark:!border-white/10 !bg-white dark:!bg-slate-900/40 overflow-hidden shadow-lg hover:shadow-xl transition-shadow">
              <div className="px-6 py-5 border-b border-slate-200/40 dark:border-white/10 bg-gradient-to-r from-blue-50 dark:from-blue-500/10 to-transparent flex items-center justify-between">
                <div>
                  <h3 className="text-[12px] font-black text-slate-900 dark:text-white uppercase tracking-widest">
                    Customer Growth vs Churn
                  </h3>
                  <p className="text-[9px] text-slate-500 dark:text-slate-400 font-bold mt-0.5">Market segment analysis</p>
                </div>
                <button
                  onClick={() => setExpandedCard('growth')}
                  className="p-2 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 dark:text-blue-400 transition-all hover:scale-110"
                  title="Expand view"
                >
                  <Eye size={18} />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <ChartMountContainer className="h-56 relative">
                  {!customerTrendData || customerTrendData.length === 0 ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                      <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-white/5 flex items-center justify-center text-slate-400 mb-3">
                        <Users size={24} />
                      </div>
                      <p className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-widest">No Customer Data Detected</p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold mt-1 max-w-[200px]">
                        AI was unable to map customer IDs in this dataset. Real-time growth tracking requires a 'Customer Name' or 'ID' column.
                      </p>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%" minWidth={280} minHeight={220}>
                      <BarChart data={customerTrendData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
                        <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                        <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                        <Tooltip
                        contentStyle={{
                          backgroundColor: '#ffffff',
                          border: '1px solid #e2e8f0',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: '700'
                        }}
                      />
                      <Bar
                        dataKey="value"
                        fill="#3b82f6"
                        radius={[6, 6, 0, 0]}
                        onClick={(data) => setSelectedCustomerTrend(data.name)}
                        cursor="pointer"
                        animationDuration={600}
                        barSize={44}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                  )}
                </ChartMountContainer>

                <div className="pt-4 border-t border-slate-200/40 dark:border-white/10 grid grid-cols-3 gap-3">
                  {customerTrendData.map((item, idx) => {
                    const colorSchemes = [
                      { bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-200/60 dark:border-emerald-500/30' },
                      { bg: 'bg-rose-50 dark:bg-rose-500/10', text: 'text-rose-600 dark:text-rose-400', border: 'border-rose-200/60 dark:border-rose-500/30' },
                      { bg: 'bg-blue-50 dark:bg-blue-500/10', text: 'text-blue-600 dark:text-blue-400', border: 'border-blue-200/60 dark:border-blue-500/30' }
                    ];
                    const scheme = colorSchemes[idx];
                    return (
                       <div 
                        key={idx} 
                        onClick={() => setSelectedCustomerTrend(item.name)}
                        className={`${scheme.bg} rounded-xl p-3 text-center border ${scheme.border} flex flex-col items-center justify-center transition-all hover:brightness-95 cursor-pointer shadow-sm`}
                      >
                        <p className={`text-[16px] font-black leading-none ${scheme.text}`}>{item.value}</p>
                        <p className={`text-[9px] font-black uppercase tracking-widest mt-1 opacity-80 ${scheme.text}`}>{item.name}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </GlassCard>
            </div>
          </div>
        )}

        {/* Customer Details Modal */}
        <AnimatePresence>
          {selectedCustomerTrend && dashboardCustomers.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
              onClick={() => setSelectedCustomerTrend(null)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                transition={{ duration: 0.2 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-2xl bg-white rounded-[2.5rem] border border-slate-200/80 shadow-[0_32px_64px_rgba(15,23,42,0.1)] overflow-hidden"
              >
                {/* Header */}
                <div className="bg-gradient-to-r from-blue-500/10 to-slate-50 border-b border-slate-200/50 px-8 py-6 flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                      {selectedCustomerTrend} Customers
                    </h2>
                    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-1">Customer Performance Overview</p>
                  </div>
                  <button
                    onClick={() => setSelectedCustomerTrend(null)}
                    className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition-all"
                  >
                    ✕
                  </button>
                </div>

                {/* Content */}
                <div className="p-8 max-h-[70vh] overflow-y-auto">
                  {(() => {
                    const trendMap = {
                      'Growing': 'up',
                      'Churn Risk': 'down',
                      'Stable': 'flat'
                    };
                    const filtered = dashboardCustomers.filter((c) => deriveCustomerTrendKey(c) === trendMap[selectedCustomerTrend]);

                    if (filtered.length === 0) {
                      return (
                        <div className="flex flex-col items-center justify-center py-12 opacity-40">
                          <Users size={32} className="mb-3" />
                          <p className="text-sm font-bold text-slate-600">No customers in this category</p>
                        </div>
                      );
                    }

                    return (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {filtered.map((customer, idx) => (
                          (() => {
                            const trendKey = deriveCustomerTrendKey(customer);
                            const trendLabel = trendKey === 'up' ? 'GROWING' : trendKey === 'down' ? 'CHURN RISK' : 'STABLE';
                            return (
                          <motion.div
                            key={idx}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.05 }}
                            className="rounded-2xl border border-slate-200/60 hover:border-blue-300 bg-slate-50/50 p-6 transition-all group"
                          >
                            <div className="flex items-start justify-between mb-4">
                              <div className="min-w-0 flex-1">
                                <h3 className="text-[13px] font-black text-slate-900 truncate uppercase tracking-tight">{getCustomerDisplayName(customer)}</h3>
                                <p className="text-[11px] text-slate-500 truncate font-medium mt-1">{getCustomerSubtitle(customer, getCustomerDisplayName(customer))}</p>
                              </div>
                              <div className={`shrink-0 px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border ${selectedCustomerTrend === 'Growing'
                                ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                                : selectedCustomerTrend === 'Churn Risk'
                                  ? 'bg-rose-500/10 text-rose-600 border-rose-500/20'
                                  : 'bg-slate-300/30 text-slate-600 border-slate-400/20'
                                }`}>
                                {trendLabel}
                              </div>
                            </div>

                            <div className="space-y-3 pt-4 border-t border-slate-200/60">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Total Purchases</span>
                                <span className="text-[13px] font-black text-slate-900 font-mono">{formatCurrency(customer.total_purchase)}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Recent Activity</span>
                                <span className="text-[11px] font-bold text-blue-600">{getRecentActivityLabel(customer)}</span>
                              </div>
                              {customer.email && (
                                <div className="flex items-center gap-2 pt-2 border-t border-slate-200/60 mt-3">
                                  <Mail size={12} className="text-slate-500" />
                                  <span className="text-[10px] text-slate-600 truncate">{customer.email}</span>
                                </div>
                              )}
                            </div>
                          </motion.div>
                            );
                          })()
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Expanded Card Modals */}
        <AnimatePresence>
          {/* Inventory Risk Distribution Expanded */}
          {expandedCard === 'inventory' && riskPieData && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
              onClick={() => setExpandedCard(null)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                transition={{ duration: 0.2 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-3xl bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-white/10 shadow-2xl overflow-hidden"
              >
                <div className="px-8 py-6 border-b border-slate-200/40 dark:border-white/10 bg-gradient-to-r from-blue-50 dark:from-blue-500/10 to-transparent flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-black text-slate-900 dark:text-white">Inventory Risk Distribution</h2>
                    <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mt-1">Stock health overview - Detailed</p>
                  </div>
                  <button
                    onClick={() => setExpandedCard(null)}
                    className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/20 flex items-center justify-center text-slate-600 dark:text-slate-300 transition-all"
                  >
                    <X size={20} />
                  </button>
                </div>
                <div className="p-8 max-h-[70vh] overflow-y-auto">
                  <ChartMountContainer className="h-96 mb-8">
                    <ResponsiveContainer width="100%" height="100%" minWidth={280} minHeight={220}>
                      <PieChart>
                        <Pie
                          data={riskPieData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={70}
                          outerRadius={130}
                          paddingAngle={2}
                        >
                          {riskPieData.map((entry) => (
                            <Cell key={entry.name} fill={entry.color} opacity={0.85} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value) => value.toLocaleString()}
                          contentStyle={{
                            backgroundColor: '#ffffff',
                            border: '1px solid #e2e8f0',
                            borderRadius: '8px',
                            fontSize: '13px',
                            fontWeight: '700'
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </ChartMountContainer>
                  <div className="grid grid-cols-3 gap-4">
                    {riskPieData.map((item) => (
                      <div key={item.name} className="p-6 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200/60 dark:border-white/10">
                        <div className="flex items-center gap-3 mb-4">
                          <div
                            className="w-4 h-4 rounded-full shadow-lg"
                            style={{ backgroundColor: item.color }}
                          />
                          <h3 className="text-[12px] font-black text-slate-900 dark:text-white uppercase tracking-tight">{item.name}</h3>
                        </div>
                        <p className="text-[24px] font-black text-slate-900 dark:text-white">{item.value}</p>
                        <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-2">Total items</p>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}

          {/* Retention Risk Alerts Expanded */}
          {expandedCard === 'retention' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
              onClick={() => setExpandedCard(null)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                transition={{ duration: 0.2 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-3xl bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-white/10 shadow-2xl overflow-hidden"
              >
                <div className="px-8 py-6 border-b border-slate-200/40 dark:border-white/10 bg-gradient-to-r from-rose-50 dark:from-rose-500/10 to-transparent flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-black text-slate-900 dark:text-white">Retention Risk Alerts</h2>
                    <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mt-1">Customers requiring attention - All</p>
                  </div>
                  <button
                    onClick={() => setExpandedCard(null)}
                    className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/20 flex items-center justify-center text-slate-600 dark:text-slate-300 transition-all"
                  >
                    <X size={20} />
                  </button>
                </div>
                <div className="p-8 max-h-[70vh] overflow-y-auto">
                  {!dashboardCustomers.length || dashboardCustomers.filter(c => deriveCustomerTrendKey(c) === 'down' || String(c.risk || '').toUpperCase().includes('CHURN')).length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 opacity-60">
                      <ShieldCheck size={48} className="mb-4 text-emerald-500" />
                      <p className="text-[14px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-300">Retention Verified</p>
                      <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-2">No churn risks detected</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {dashboardCustomers
                        .filter(c => deriveCustomerTrendKey(c) === 'down' || String(c.risk || '').toUpperCase().includes('CHURN'))
                        .sort((a, b) => toNum(b.total_purchase, 0) - toNum(a.total_purchase, 0))
                        .map((c, i) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.06 }}
                          className="p-6 rounded-xl bg-gradient-to-r from-rose-50 to-orange-50 dark:from-rose-500/10 dark:to-orange-500/5 border border-rose-200/60 dark:border-rose-500/30 hover:border-rose-300 dark:hover:border-rose-500/60 transition-all"
                        >
                          <div className="flex justify-between items-start gap-4 mb-4">
                            <div className="flex-1">
                              <h4 className="text-[13px] font-black text-slate-900 dark:text-white uppercase tracking-tight">{c.name}</h4>
                              <p className="text-[11px] text-slate-600 dark:text-slate-400 font-medium mt-1">{c.company || 'Portfolio'}</p>
                            </div>
                            <div className="shrink-0 bg-rose-500 text-white px-3 py-1.5 rounded-full text-[8px] font-black uppercase border border-rose-600 shadow-md">
                              RISK
                            </div>
                          </div>

                          <div className="pt-4 border-t border-rose-200/60 dark:border-rose-500/20 space-y-3">
                            <div className="grid grid-cols-2 gap-4">

                              <div>
                                <span className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest">Last Purchase</span>
                                <p className="text-[13px] font-black text-slate-900 dark:text-white mt-1">{c.last_purchase_date || 'Recent'}</p>
                              </div>
                            </div>
                            {c.email && (
                              <div className="flex items-center gap-2 bg-slate-100 dark:bg-white/10 rounded-lg p-3 mt-3">
                                <Mail size={14} className="text-slate-600 dark:text-slate-400 shrink-0" />
                                <p className="text-[11px] text-slate-600 dark:text-slate-400 truncate font-medium">{c.email}</p>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}

          {/* Sales Performance Expanded */}
          {expandedCard === 'sales' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
              onClick={() => setExpandedCard(null)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                transition={{ duration: 0.2 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-5xl bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-white/10 shadow-2xl overflow-hidden"
              >
                <div className="px-8 py-6 border-b border-slate-200/40 dark:border-white/10 bg-gradient-to-r from-emerald-50 dark:from-emerald-500/10 to-transparent flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-black text-slate-900 dark:text-white">Sales Performance Deep Dive</h2>
                    <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mt-1">
                      Full timeline insights with year-wise context
                    </p>
                  </div>
                  <button
                    onClick={() => setExpandedCard(null)}
                    className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/20 flex items-center justify-center text-slate-600 dark:text-slate-300 transition-all"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="p-8 max-h-[78vh] overflow-y-auto space-y-6">
                  <div className="rounded-xl border border-slate-200/70 dark:border-white/10 p-4 bg-slate-50 dark:bg-slate-800/30 flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 dark:text-slate-300">Data Scope</p>
                      <p className="text-[13px] font-bold text-slate-800 dark:text-slate-200 mt-2">{salesInsights?.scopeLabel || 'No data available in this mode'}</p>
                    </div>
                    <div className="inline-flex items-center rounded-full p-1 bg-slate-100 dark:bg-white/10 border border-slate-200/70 dark:border-white/10">
                      {[
                        { key: 'past', label: 'Past' },
                        { key: 'future', label: 'Future' },
                        { key: 'both', label: 'Both' },
                      ].map((mode) => (
                        <button
                          key={mode.key}
                          onClick={() => setSalesModalView(mode.key)}
                          className={`px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-wider transition-all ${salesModalView === mode.key ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:bg-white/70 dark:hover:bg-white/20'}`}
                        >
                          {mode.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {!salesInsights ? (
                    <div className="rounded-xl border border-amber-200/70 dark:border-amber-500/20 p-6 bg-amber-50/70 dark:bg-amber-500/10">
                      <p className="text-[12px] font-black text-amber-700 dark:text-amber-300 uppercase tracking-wider">No data in selected mode</p>
                      <p className="text-[11px] text-amber-700/90 dark:text-amber-200/90 mt-2">Please switch to another mode (Past, Future, Both) to view accurate metrics for available data.</p>
                    </div>
                  ) : (
                    <>
                      <div className="rounded-xl border border-slate-200/70 dark:border-white/10 p-4 bg-slate-50 dark:bg-slate-800/30">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 dark:text-slate-300">Coverage Window</p>
                        <p className="text-[13px] font-bold text-slate-800 dark:text-slate-200 mt-2">
                          {salesInsights.coverageStart.date.toLocaleDateString('en-GB')} to {salesInsights.coverageEnd.date.toLocaleDateString('en-GB')} ({salesInsights.coverageStart.date.getFullYear()}-{salesInsights.coverageEnd.date.getFullYear()})
                        </p>
                      </div>

                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="rounded-xl border border-slate-200/70 dark:border-white/10 p-4 bg-white dark:bg-slate-900">
                      <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">Peak</p>
                      <p className="text-[16px] font-black text-slate-900 dark:text-white">{Math.round(salesInsights.peak.value).toLocaleString()} units</p>
                      <p className="text-[10px] text-slate-500">{salesInsights.peak.date.toLocaleDateString('en-GB')}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200/70 dark:border-white/10 p-4 bg-white dark:bg-slate-900">
                      <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">Lowest</p>
                      <p className="text-[16px] font-black text-slate-900 dark:text-white">{Math.round(salesInsights.low.value).toLocaleString()} units</p>
                      <p className="text-[10px] text-slate-500">{salesInsights.low.date.toLocaleDateString('en-GB')}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200/70 dark:border-white/10 p-4 bg-white dark:bg-slate-900">
                      <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">Latest</p>
                      <p className="text-[16px] font-black text-slate-900 dark:text-white">{Math.round(salesInsights.latest.value).toLocaleString()} units</p>
                      <p className="text-[10px] text-slate-500">{salesInsights.latest.date.toLocaleDateString('en-GB')}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200/70 dark:border-white/10 p-4 bg-white dark:bg-slate-900">
                      <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">Trend + Volatility</p>
                      <p className="text-[16px] font-black text-slate-900 dark:text-white">{salesInsights.trendLabel}</p>
                      <p className="text-[10px] text-slate-500">Volatility: {salesInsights.volatilityPct.toFixed(1)}%</p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200/70 dark:border-white/10 p-4 bg-white dark:bg-slate-900">
                    <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 dark:text-slate-300">Sales Trend (Swap Mode)</p>
                      <p className="text-[10px] font-bold text-slate-500">Mode: {salesInsights.scopeLabel}</p>
                    </div>
                    <ChartMountContainer className="h-72">
                      <ResponsiveContainer width="100%" height="100%" minWidth={280} minHeight={220}>
                        <LineChart
                          data={salesModalTrendData}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                          <XAxis
                            dataKey="period"
                            tick={{ fill: '#64748b', fontSize: 11 }}
                            tickFormatter={(value) => {
                              const date = parseDate(value);
                              if (!date) return value;
                              return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
                            }}
                          />
                          <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
                          <Tooltip
                            formatter={(value) => [Math.round(Number(value) || 0).toLocaleString(), 'Units']}
                            labelFormatter={(value) => {
                              const date = parseDate(value);
                              if (!date) return String(value || '');
                              return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                            }}
                            contentStyle={{
                              backgroundColor: '#ffffff',
                              border: '1px solid #e2e8f0',
                              borderRadius: '8px',
                              fontSize: '12px',
                              fontWeight: '700',
                            }}
                          />
                          {(salesModalView === 'past' || salesModalView === 'both') && (
                            <Line type="monotone" dataKey="pastUnits" name="Past" stroke="#3b82f6" strokeWidth={3} dot={false} connectNulls />
                          )}
                          {(salesModalView === 'future' || salesModalView === 'both') && (
                            <Line type="monotone" dataKey="forecastUnits" name="Future" stroke="#10b981" strokeWidth={3} strokeDasharray="6 4" dot={false} connectNulls />
                          )}
                        </LineChart>
                      </ResponsiveContainer>
                    </ChartMountContainer>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-xl border border-emerald-200/70 dark:border-emerald-500/20 p-4 bg-emerald-50/50 dark:bg-emerald-500/5">
                      <p className="text-[9px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Biggest Rise</p>
                      <p className="text-[13px] font-black text-emerald-700 dark:text-emerald-300">
                        +{Math.round(salesInsights.biggestRise?.delta || 0).toLocaleString()} units ({(salesInsights.biggestRise?.deltaPct || 0).toFixed(1)}%)
                      </p>
                      <p className="text-[10px] text-emerald-700/80 dark:text-emerald-300/80">
                        {salesInsights.biggestRise?.from?.date?.toLocaleDateString('en-GB')} to {salesInsights.biggestRise?.to?.date?.toLocaleDateString('en-GB')}
                      </p>
                    </div>
                    <div className="rounded-xl border border-rose-200/70 dark:border-rose-500/20 p-4 bg-rose-50/50 dark:bg-rose-500/5">
                      <p className="text-[9px] font-black uppercase tracking-wider text-rose-600 dark:text-rose-400">Biggest Drop</p>
                      <p className="text-[13px] font-black text-rose-700 dark:text-rose-300">
                        {Math.round(salesInsights.biggestDrop?.delta || 0).toLocaleString()} units ({(salesInsights.biggestDrop?.deltaPct || 0).toFixed(1)}%)
                      </p>
                      <p className="text-[10px] text-rose-700/80 dark:text-rose-300/80">
                        {salesInsights.biggestDrop?.from?.date?.toLocaleDateString('en-GB')} to {salesInsights.biggestDrop?.to?.date?.toLocaleDateString('en-GB')}
                      </p>
                    </div>
                  </div>

                  {Array.isArray(salesInsights.yearlyBreakdown) && salesInsights.yearlyBreakdown.length > 0 && (
                    <div className="rounded-xl border border-slate-200/70 dark:border-white/10 p-4 bg-slate-50 dark:bg-slate-800/30">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 dark:text-slate-300 mb-3">Year-wise Performance</p>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {salesInsights.yearlyBreakdown.map((y) => (
                          <div key={y.year} className="rounded-lg border border-slate-200/70 dark:border-white/10 bg-white dark:bg-slate-900 px-3 py-3">
                            <p className="text-[10px] font-black text-slate-500">Year {y.year}</p>
                            <p className="text-[12px] font-black text-slate-900 dark:text-white">Total: {Math.round(y.totalUnits).toLocaleString()} units</p>
                            <p className="text-[10px] text-slate-500">Avg: {Math.round(y.avgUnits).toLocaleString()} | Peak: {Math.round(y.peak).toLocaleString()}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {Array.isArray(salesInsights.timelineEvents) && salesInsights.timelineEvents.length > 0 && (
                    <div className="rounded-xl border border-slate-200/70 dark:border-white/10 bg-white dark:bg-slate-900 p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 dark:text-slate-300 mb-3">Event Timeline (Date + Year)</p>
                      <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                        {salesInsights.timelineEvents.map((event, idx) => (
                          <div key={`${event.kind}-${idx}`} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200/70 dark:border-white/10 px-3 py-2">
                            <div className="min-w-0">
                              <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">{event.kind}</p>
                              <p className="text-[11px] font-bold text-slate-800 dark:text-slate-200 break-words">{event.message}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-[10px] font-black text-slate-700 dark:text-slate-200">{event.dateLabel}</p>
                              <p className="text-[10px] text-slate-500">{event.year}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                    </>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}


          {/* Product Purchase Modal */}
          <ProductPurchaseModal
            isOpen={!!selectedClientForModal}
            onClose={() => setSelectedClientForModal(null)}
            client={selectedClientForModal}
          />

          {/* Customer Growth vs Churn Expanded */}
          {expandedCard === 'growth' && customerTrendData && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
              onClick={() => setExpandedCard(null)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                transition={{ duration: 0.2 }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-4xl bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-white/10 shadow-2xl overflow-hidden"
              >
                <div className="px-8 py-6 border-b border-slate-200/40 dark:border-white/10 bg-gradient-to-r from-blue-50 dark:from-blue-500/10 to-transparent flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-black text-slate-900 dark:text-white">Customer Growth vs Churn</h2>
                    <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mt-1">Market segment analysis - Detailed</p>
                  </div>
                  <button
                    onClick={() => setExpandedCard(null)}
                    className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-white/10 hover:bg-slate-200 dark:hover:bg-white/20 flex items-center justify-center text-slate-600 dark:text-slate-300 transition-all"
                  >
                    <X size={20} />
                  </button>
                </div>
                <div className="p-8 max-h-[70vh] overflow-y-auto">
                  <ChartMountContainer className="h-80 mb-8 relative">
                    {!customerTrendData || customerTrendData.length === 0 ? (
                      <div className="absolute inset-0 flex flex-col items-center justify-center p-10 text-center">
                        <div className="w-16 h-16 rounded-[2rem] bg-slate-100 dark:bg-white/5 flex items-center justify-center text-slate-400 mb-4">
                          <Users size={32} />
                        </div>
                        <h4 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">Detailed Segment Analysis Unavailable</h4>
                        <p className="text-sm text-slate-500 dark:text-slate-400 font-bold mt-2 max-w-md">
                          We found {analysis?.summary?.total_products || 0} products but couldn't identify distinct buyers. 
                          To unlock growth insights, please ensure your file contains a column for Customer Name or Account ID.
                        </p>
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%" minWidth={280} minHeight={220}>
                      <BarChart data={customerTrendData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                        <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                        <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#ffffff',
                            border: '1px solid #e2e8f0',
                            borderRadius: '8px',
                            fontSize: '13px',
                            fontWeight: '700'
                          }}
                        />
                        <Bar
                          dataKey="value"
                          fill="#3b82f6"
                          radius={[8, 8, 0, 0]}
                          animationDuration={800}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                    )}
                  </ChartMountContainer>
                  <div className="grid grid-cols-3 gap-4">
                    {customerTrendData.map((item, idx) => {
                      const colorSchemes = [
                        { bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-200/60 dark:border-emerald-500/30' },
                        { bg: 'bg-rose-50 dark:bg-rose-500/10', text: 'text-rose-600 dark:text-rose-400', border: 'border-rose-200/60 dark:border-rose-500/30' },
                        { bg: 'bg-blue-50 dark:bg-blue-500/10', text: 'text-blue-600 dark:text-blue-400', border: 'border-blue-200/60 dark:border-blue-500/30' }
                      ];
                      const scheme = colorSchemes[idx];
                      return (
                        <div key={idx} className={`${scheme.bg} rounded-xl p-6 text-center border ${scheme.border}`}>
                          <p className={`text-[12px] font-black uppercase tracking-tight opacity-80 ${scheme.text}`}>{item.name}</p>
                          <p className={`text-[32px] font-black mt-3 ${scheme.text}`}>{item.value}</p>
                          <p className={`text-[10px] font-bold mt-2 ${scheme.text}`}>Total customers</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>

      <FullScreenChart
        open={isLayoutFullscreen}
        onClose={closeFullscreen}
        topLeft={(
          <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white/90 px-3 py-2 shadow-xl shadow-slate-900/10 ring-1 ring-white/50">
          </div>
        )}
        bottomBar={(
          <motion.div
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="flex items-center gap-4 rounded-2xl bg-slate-900/90 px-5 py-4 text-white shadow-2xl ring-1 ring-white/10"
          >
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleForecastModeToggle}
              className="px-5 py-2.5 rounded-xl bg-white/10 text-[11px] font-black uppercase tracking-widest transition-all"
            >
              {forecastMode === 'past' ? 'View Forecast' : 'View Past'}
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleRefreshData}
              disabled={isRefreshing}
              className="p-2.5 rounded-xl bg-blue-500/20 text-blue-200 transition-all"
              title="Refresh data"
            >
              <RefreshCw size={18} className={isRefreshing ? 'animate-spin' : ''} />
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleExportChart}
              className="p-2.5 rounded-xl bg-emerald-500/20 text-emerald-200 transition-all"
              title="Export data"
            >
              <Download size={18} />
            </motion.button>
          </motion.div>
        )}
      >
        <div className="h-full w-full">
          <PredictionChart
            pastData={displayPastData}
            forecastData={displayForecastData}
            mode={forecastMode}
            showLegend={false}
            height="100%"
            fullScreen
          />
        </div>
      </FullScreenChart>
    </>
  );
};

export default Dashboard;

