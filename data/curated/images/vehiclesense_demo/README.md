# VehicleSense demo images

Sample inspection images used by the VehicleSense AI demo. The AI boxes and labels are **pre-drawn on the images** (sample data, not model output); the app labels them as *Sample images*.

- `full/` full-resolution PNGs · `web/` web-size JPGs · `series/` the crops the app shows
- `manifest.json` has the same mapping in machine-readable form, plus findings, sizes and SHA-1 checksums
- Re-import after adding images: `python scripts/import_sam_img.py /path/to/sam_img`

| ID | Image | Kind | App capture | Used by vehicles | Original file(s) in sam_img |
|---|---|---|---|---|---|
| 01 | [Fleet case 7 · windshield crack](full/01_fleet-case-07_windshield-crack.png) | comparison | #1 (`c01o.jpg`) | BPR 7730 | `1.png`<br>`VehicleSense_Full_Demo/assets/ai_windshield_crack_inspection_comparison.png` |
| 02 | [Fleet case 8 · headlamp haze, panel misalignment](full/02_fleet-case-08_headlamp-haze_panel-misalignment.png) | comparison | #2 (`c02o.jpg`) | VCC 8841 | `2.png`<br>`VehicleSense_Full_Demo/assets/ai_vehicle_inspection_two_issues_detected.png` |
| 03 | [Fleet case 9 · uneven tyre wear, sidewall bulge](full/03_fleet-case-09_tyre-uneven-wear_sidewall-bulge.png) | comparison | #3 (`c03o.jpg`) | WXD 2291 | `3.png`<br>`VehicleSense_Full_Demo/assets/ai_tyre_inspection_two_issues_detected.png` |
| 04 | [Fleet case 10 · tail lamp crack, rear door misalignment](full/04_fleet-case-10_van-tail-lamp-crack_door-misalignment.png) | comparison | #4 (`c04o.jpg`) | JTR 5510 | `4.png`<br>`VehicleSense_Full_Demo/assets/ai_van_inspection_two_issues_detected.png` |
| 05 | [Fleet case 11 · flood / water ingress in the cabin](full/05_fleet-case-11_interior-flood-water-ingress.png) | comparison | #5 (`c05o.jpg`) | — | `5.png`<br>`VehicleSense_Full_Demo/assets/ai_interior_damage_inspection_montage.png` |
| 06 | [Fleet case 12 · loose heat shield, bracket corrosion](full/06_fleet-case-12_underbody-heat-shield_bracket-corrosion.png) | comparison | #6 (`c06o.jpg`) | WQK 9054 | `6.png`<br>`VehicleSense_Full_Demo/assets/ai_undercarriage_inspection_comparison.png` |
| 07 | [Fleet case 1 · sedan dent, scratch, rust](full/07_fleet-case-01_sedan-dent-scratch-rust.png) | comparison | #7 (`c07o.jpg`) | VKR 3128 | `7.png`<br>`VehicleSense_Full_Demo/assets/fleet_inspection_ai_damage_analysis.png` |
| 08 | [Fleet case 2 · panel van dent, scratch, rust](full/08_fleet-case-02_van-dent-scratch-rust.png) | comparison | #8 (`c08o.jpg`) | BHY 7783 | `8.png`<br>`VehicleSense_Full_Demo/assets/ai_van_inspection_three_issues_detected.png` |
| 09 | [Fleet case 3 · pickup underbody fluid leak](full/09_fleet-case-03_pickup-underbody-fluid-leak.png) | comparison | #9 (`c09o.jpg`) | BMK 6620, WXD 2291 | `9.png`<br>`VehicleSense_Full_Demo/assets/ai_underbody_leak_inspection_comparison.png` |
| 10 | [Fleet case 4 · hatchback roof dent](full/10_fleet-case-04_hatchback-roof-dent.png) | comparison | #10 (`c10o.jpg`) | WVA 1209 | `10.png`<br>`VehicleSense_Full_Demo/assets/ai_dent_detection_fleet_inspection_comparison.png` |
| 11 | [Fleet case 5 · interior wear and stains](full/11_fleet-case-05_interior-wear-stains.png) | comparison | #11 (`c11o.jpg`) | — | `11.png`<br>`VehicleSense_Full_Demo/assets/toyota_interior_inspection_original_vs_ai_analysi.png` |
| 12 | [Fleet case 6 · MPV scratch](full/12_fleet-case-06_mpv-scratch.png) | comparison | #12 (`c12o.jpg`) | PKE 4410 | `12.png`<br>`VehicleSense_Full_Demo/assets/vehicle_inspection_ai_scratch_detection.png` |
| 13 | [Lane 3 · Case 5 · pit camera fluid leak](full/13_lane-case-5_pit-fluid-leak.png) | comparison | #13 (`c13o.jpg`) | BMK 6620 | `13.png` |
| 14 | [Lane 3 · Case 4 · roof dent (VJM 7412)](full/14_lane-case-4_roof-dent_VJM7412.png) | comparison | #14 (`c14o.jpg`) | — | `14.png`<br>`VehicleSense_Full_Demo/assets/ai_roof_dent_inspection_comparison.png` |
| 15 | [Lane 3 · Case 3 · rear scratch (VJM 7412)](full/15_lane-case-3_rear-scratch_VJM7412.png) | comparison | #15 (`c15o.jpg`) | VJM 7412 | `15.png`<br>`VehicleSense_Full_Demo/assets/before_and_after_ai_scratch_detection.png` |
| 16 | [Lane 3 · Case 1 · dent, scratch, rust (VJM 3287)](full/16_lane-case-1_front-dent-scratch-rust_VJM3287.png) | comparison | #16 (`c16o.jpg`) | VJM 3287 | `16.png`<br>`VehicleSense_Full_Demo/assets/ai_powered_vehicle_damage_inspection.png` |
| 17 | [Lane 3 · Case 2 · rear dent, scratch, rust (VJM 7412)](full/17_lane-case-2_rear-dent-scratch-rust_VJM7412.png) | comparison | #23 (`c17o.jpg`) | — | `VehicleSense_Full_Demo/assets/split_screen_ai_vehicle_inspection.png` |
| i1 | [Close-up · brakes: disc scoring, uneven pad wear (VKR 3128)](full/i1_closeup-brakes_disc-scoring_VKR3128.png) | closeup | #17 (`n1o.jpg`) | VKR 3128 | `1/i1.png` |
| i2 | [Close-up · emissions: visible smoke, soot (BHY 7783)](full/i2_closeup-emissions_smoke-soot_BHY7783.png) | closeup | #18 (`n2o.jpg`) | BHY 7783 | `1/i2.png` |
| i3 | [Close-up · suspension: oil-wet shock, cracked bush (JTR 5510)](full/i3_closeup-suspension_oil-wet-shock_JTR5510.png) | closeup | #19 (`n3o.jpg`) | JTR 5510 | `1/i3.png` |
| i4 | [Close-up · ADAS camera mount tilted (PKE 4410)](full/i4_closeup-adas-camera-tilt_PKE4410.png) | closeup | #20 (`n4o.jpg`) | PKE 4410 | `1/i4.png` |
| i5 | [Close-up · 12 V battery terminal corrosion, swelling (VJM 7412)](full/i5_closeup-12v-battery-corrosion_VJM7412.png) | closeup | #21 (`n5o.jpg`) | VJM 7412 | `1/i5.png` |
| i6 | [Close-up · brake pads at 5 mm (WVA 1209)](full/i6_closeup-brake-pads-5mm_WVA1209.png) | closeup | #22 (`n6o.jpg`) | WVA 1209 | `1/i6.png` |
| i7 | [Progression · rust at the wheel arch, Jan → May → Sep 2026 (VJM 3287)](full/i7_progression-rust_jan-may-sep-2026_VJM3287.png) | progression | — | VJM 3287 | `1/i7.png` |
| i8 | [Progression · tyre tread wear, Nov 2025 → Apr → Sep 2026 (WXD 2291)](full/i8_progression-tread-wear_nov2025-apr-sep-2026_WXD2291.png) | progression | — | WXD 2291 | `1/i8.png` |
| i9 | [Progression · windscreen crack growth, Mar → Jun → Sep 2026 (BPR 7730)](full/i9_progression-windscreen-crack_mar-jun-sep-2026_BPR7730.png) | progression | — | BPR 7730 | `1/i9.png` |

