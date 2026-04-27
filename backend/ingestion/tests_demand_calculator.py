from django.test import SimpleTestCase
import pandas as pd

from ingestion.demand_calculator import compute_inventory_metrics, generate_full_analysis_payload


class DemandCalculatorTests(SimpleTestCase):
    def _to_map(self, records):
        return {row['product']: row for row in records}

    def test_demand_uses_party_level_max_without_double_counting(self):
        rows = [
            {
                'DATE': '2025-04-01',
                'PRODUCT': 'P1',
                'PARTY NAME': 'Party A',
                'IN/OUT': 'IN',
                'QUANTITY': -7,
                'CHECK QUANTITY': -7,
            },
            {
                'DATE': '2025-04-02',
                'PRODUCT': 'P1',
                'PARTY NAME': 'Party A',
                'IN/OUT': 'OUT',
                'QUANTITY': 7,
                'CHECK QUANTITY': -14,
            },
            {
                'DATE': '2025-04-03',
                'PRODUCT': 'P1',
                'PARTY NAME': 'Party B',
                'IN/OUT': 'OUT',
                'QUANTITY': 7,
                'CHECK QUANTITY': -21,
            },
        ]

        out = self._to_map(compute_inventory_metrics(pd.DataFrame(rows)))

        self.assertIn('P1', out)
        self.assertEqual(out['P1']['total_demand'], 14.0)
        self.assertEqual(out['P1']['on_hand'], 21.0)
        self.assertEqual(out['P1']['stock_required'], 0.0)

    def test_on_hand_uses_only_latest_check_quantity(self):
        rows = [
            {
                'DATE': '2025-04-01',
                'PRODUCT': 'P2',
                'PARTY NAME': 'Party A',
                'IN/OUT': 'OUT',
                'QUANTITY': 7,
                'CHECK QUANTITY': -7,
            },
            {
                'DATE': '2025-04-05',
                'PRODUCT': 'P2',
                'PARTY NAME': 'Party A',
                'IN/OUT': 'OUT',
                'QUANTITY': 10,
                'CHECK QUANTITY': -58,
            },
            {
                'DATE': '2025-04-10',
                'PRODUCT': 'P2',
                'PARTY NAME': 'Party A',
                'IN/OUT': 'OUT',
                'QUANTITY': 5,
                'CHECK QUANTITY': 0,
            },
        ]

        out = self._to_map(compute_inventory_metrics(pd.DataFrame(rows)))

        self.assertEqual(out['P2']['total_demand'], 22.0)
        self.assertEqual(out['P2']['on_hand'], 0.0)
        self.assertEqual(out['P2']['stock_required'], 22.0)

    def test_ignores_zero_invalid_quantities_and_rounds_to_2_decimals(self):
        rows = [
            {
                'DATE': '30-Apr-2025',
                'PRODUCT': 'P3',
                'PARTY NAME': 'Party C',
                'IN/OUT': 'OUT',
                'QUANTITY': 0,
                'CHECK QUANTITY': -5,
            },
            {
                'DATE': '30-Apr-2025',
                'PRODUCT': 'P3',
                'PARTY NAME': 'Party C',
                'IN/OUT': 'OUT',
                'QUANTITY': 1.755,
                'CHECK QUANTITY': 2,
            },
            {
                'DATE': '01-May-2025',
                'PRODUCT': 'P3',
                'PARTY NAME': 'Party C',
                'IN/OUT': 'IN',
                'QUANTITY': -1.2,
                'CHECK QUANTITY': -3,
            },
            {
                'DATE': '01-May-2025',
                'PRODUCT': 'P3',
                'PARTY NAME': '',
                'IN/OUT': 'OUT',
                'QUANTITY': 999,
                'CHECK QUANTITY': -3,
            },
        ]

        out = self._to_map(compute_inventory_metrics(pd.DataFrame(rows)))

        self.assertEqual(out['P3']['total_demand'], 1.76)
        self.assertEqual(out['P3']['on_hand'], 3.0)
        self.assertEqual(out['P3']['stock_required'], 0.0)

        for key in ['total_demand', 'on_hand', 'stock_required']:
            self.assertGreaterEqual(out['P3'][key], 0.0)

    def test_latest_zero_quantity_cancels_party_demand(self):
        rows = [
            {
                'DATE': '2025-04-01',
                'PRODUCT': 'P4',
                'PARTY NAME': 'Party A',
                'IN/OUT': 'OUT',
                'QUANTITY': 12,
                'CHECK QUANTITY': -12,
            },
            {
                'DATE': '2025-04-10',
                'PRODUCT': 'P4',
                'PARTY NAME': 'Party A',
                'IN/OUT': 'OUT',
                'QUANTITY': 0,
                'CHECK QUANTITY': -12,
            },
            {
                'DATE': '2025-04-05',
                'PRODUCT': 'P4',
                'PARTY NAME': 'Party B',
                'IN/OUT': 'OUT',
                'QUANTITY': 5,
                'CHECK QUANTITY': -17,
            },
        ]

        out = self._to_map(compute_inventory_metrics(pd.DataFrame(rows)))

        # Party A is cancelled by latest zero quantity, only Party B contributes.
        self.assertEqual(out['P4']['total_demand'], 5.0)
        self.assertEqual(out['P4']['on_hand'], 12.0)
        self.assertEqual(out['P4']['stock_required'], 0.0)

    def test_latest_row_selection_handles_iso_dates_correctly(self):
        rows = [
            {
                'DATE': '2026-03-05 00:00:00',
                'PRODUCT': 'P5',
                'PARTY NAME': 'Party A',
                'IN/OUT': 'IN',
                'QUANTITY': -5,
                'CHECK QUANTITY': -5,
            },
            {
                'DATE': '2026-03-06 00:00:00',
                'PRODUCT': 'P5',
                'PARTY NAME': 'Party A',
                'IN/OUT': 'OUT',
                'QUANTITY': 4,
                'CHECK QUANTITY': -1,
            },
            {
                'DATE': '2026-03-31 00:00:00',
                'PRODUCT': 'P5',
                'PARTY NAME': 'Party A',
                'IN/OUT': 'IN',
                'QUANTITY': -1,
                'CHECK QUANTITY': -3,
            },
        ]

        out = self._to_map(compute_inventory_metrics(pd.DataFrame(rows)))

        # Latest date is 2026-03-31, so on_hand must come from CHECK QUANTITY=-3.
        self.assertEqual(out['P5']['on_hand'], 3.0)

    def test_on_hand_uses_absolute_latest_check_quantity_value(self):
        rows = [
            {
                'DATE': '2026-04-01',
                'PRODUCT': 'P6',
                'PARTY NAME': 'Party A',
                'IN/OUT': 'OUT',
                'QUANTITY': 3,
                'CHECK QUANTITY': -2,
            },
            {
                'DATE': '2026-04-02',
                'PRODUCT': 'P6',
                'PARTY NAME': 'Party A',
                'IN/OUT': 'IN',
                'QUANTITY': -1,
                'CHECK QUANTITY': 7,
            },
        ]

        out = self._to_map(compute_inventory_metrics(pd.DataFrame(rows)))
        self.assertEqual(out['P6']['on_hand'], 7.0)

    def test_same_date_latest_row_prefers_higher_sr_no(self):
        rows = [
            {
                'DATE': '2026-04-01 00:00:00',
                'PRODUCT': 'P7',
                'PARTY NAME': 'Party A',
                'IN/OUT': 'OUT',
                'QUANTITY': 5,
                'CHECK QUANTITY': -273,
                'SR NO': 101,
            },
            {
                'DATE': '2026-04-01 00:00:00',
                'PRODUCT': 'P7',
                'PARTY NAME': 'Party A',
                'IN/OUT': 'OUT',
                'QUANTITY': 5,
                'CHECK QUANTITY': -253,
                'SR NO': 100,
            },
        ]

        out = self._to_map(compute_inventory_metrics(pd.DataFrame(rows)))
        self.assertEqual(out['P7']['on_hand'], 273.0)

    def test_full_payload_includes_clean_sales_series_and_forecast(self):
        rows = [
            {
                'DATE': '2026-01-01',
                'PRODUCT': 'P8',
                'PARTY NAME': 'Party A',
                'IN/OUT': 'OUT',
                'QUANTITY': 10,
                'CHECK QUANTITY': -40,
            },
            {
                'DATE': '2026-01-02',
                'PRODUCT': 'P8',
                'PARTY NAME': 'Party A',
                'IN/OUT': 'OUT',
                'QUANTITY': 12,
                'CHECK QUANTITY': -28,
            },
            {
                'DATE': '2026-01-03',
                'PRODUCT': 'P8',
                'PARTY NAME': 'Party A',
                'IN/OUT': 'OUT',
                'QUANTITY': 14,
                'CHECK QUANTITY': -14,
            },
        ]
        payload = generate_full_analysis_payload(pd.DataFrame(rows))

        self.assertTrue(isinstance(payload.get("past_sales_daily"), list))
        self.assertEqual(len(payload.get("past_sales_daily")), 3)
        self.assertTrue(isinstance(payload.get("demand_forecast"), list))
        self.assertGreater(len(payload.get("demand_forecast")), 0)
        self.assertEqual(payload.get("demand_forecast_is_synthetic"), False)
        self.assertEqual(payload.get("demand_forecast_source"), "strict_clean_sales")
        self.assertIn("next_365_days", payload.get("forecast", {}))

    def test_full_payload_marks_low_signal_when_sales_rows_invalid(self):
        rows = [
            {
                'DATE': '',
                'PRODUCT': 'P9',
                'PARTY NAME': 'Party A',
                'IN/OUT': 'OUT',
                'QUANTITY': 0,
                'CHECK QUANTITY': 0,
            },
            {
                'DATE': 'invalid-date',
                'PRODUCT': 'P9',
                'PARTY NAME': 'Party A',
                'IN/OUT': 'RETURN',
                'QUANTITY': 0,
                'CHECK QUANTITY': 0,
            },
        ]
        payload = generate_full_analysis_payload(pd.DataFrame(rows))

        self.assertEqual(payload.get("demand_forecast_is_synthetic"), True)
        self.assertEqual(payload.get("demand_forecast_source"), "insufficient_clean_signal")
        self.assertEqual(payload.get("demand_forecast"), [])
        self.assertEqual(payload.get("past_sales_daily"), [])
        self.assertIn("metadata", payload)
        self.assertIn("forecast_quality", payload.get("metadata", {}))

