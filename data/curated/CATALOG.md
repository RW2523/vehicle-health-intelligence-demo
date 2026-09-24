# Data catalogue

Generated 24 Sep 2026. 4,534 curated files, 515 MB. `manifest.csv` has one row per file (source, licence, original path, label, size).

## 1. Images (real, JPEG, max 1280 px)

| Domain | Label | Files | Demo use |
|---|---|---|---|
| corrosion | corrosion_industrial_metal | 137 | Undercarriage/body corrosion detector (feature 8) |
| flood | reference_photo_with_overlay | 2 | Flood reference only - see gaps |
| plates_my | real_plate_photo | 625 | ANPR + OCR (5, 6) |
| plates_my | synthetic_plate | 120 | ANPR + OCR (5, 6) |
| tyre | defective | 450 | Tyre AI (10), pre-inspection self-check (3) |
| tyre | perfect | 450 | Tyre AI (10), pre-inspection self-check (3) |
| tyre | wear_examples | 4 | Tyre AI (10), pre-inspection self-check (3) |
| vehicle_damage | dent_scratch_annotated | 78 | ASTRA-style above-carriage damage, BER/rebuild checks (9, 18) |
| vehicle_damage | f_breakage | 200 | ASTRA-style above-carriage damage, BER/rebuild checks (9, 18) |
| vehicle_damage | f_crushed | 200 | ASTRA-style above-carriage damage, BER/rebuild checks (9, 18) |
| vehicle_damage | f_normal | 200 | ASTRA-style above-carriage damage, BER/rebuild checks (9, 18) |
| vehicle_damage | mixed_damage_test | 68 | ASTRA-style above-carriage damage, BER/rebuild checks (9, 18) |
| vehicle_damage | r_breakage | 200 | ASTRA-style above-carriage damage, BER/rebuild checks (9, 18) |
| vehicle_damage | r_crushed | 200 | ASTRA-style above-carriage damage, BER/rebuild checks (9, 18) |
| vehicle_damage | r_normal | 200 | ASTRA-style above-carriage damage, BER/rebuild checks (9, 18) |

## 2. Audio (real recordings, 16 kHz mono WAV, 5-second clips)

Used for the acoustic fault classifier and fingerprint (features 13, 14) and the phone self-check (3). `background_*` clips are lane-noise negatives.

| Label | Clips |
|---|---|
| background_bus | 5 |
| background_car_crashes | 7 |
| background_car_horn | 3 |
| background_drilling | 5 |
| background_motorcycle | 5 |
| background_truck | 5 |
| background_truck_horn | 2 |
| engine_abnormal_other | 26 |
| engine_knocking | 234 |
| engine_normal_idle | 243 |
| engine_recording_multi_brand | 585 |
| engine_ticking | 4 |
| fault_bad_cv_joint | 1 |
| fault_bad_transimision | 2 |
| fault_bad_wheal_bearing | 8 |
| fault_belt_and_accessory_issues | 12 |
| fault_braking_system_issues | 4 |
| fault_clunking_over_bumps_bad_stabilizer_link_ | 1 |
| fault_engine_and_powertrain_issues | 61 |
| fault_engine_chriping_squealing_belt | 1 |
| fault_engine_misfire | 1 |
| fault_engine_rattle_noise | 1 |
| fault_exhaust_and_fuel_system_issue | 16 |
| fault_flooded_engin | 1 |
| fault_fuel_pump_cartridge_fault | 1 |
| fault_general_vehicle_sounds | 38 |
| fault_knocking | 2 |
| fault_lifter_ticking | 1 |
| fault_loose_exhaust_shield | 1 |
| fault_misc | 5 |
| fault_miscellaneous_issues | 5 |
| fault_muffler_running_loud_exhaust_leak | 1 |
| fault_pre_ignition | 2 |
| fault_problem_6 | 2 |
| fault_radiator_fan_failure | 1 |
| fault_seized_engin | 1 |
| fault_squeaky_belt | 1 |
| fault_squeaky_brake_grinding_brake | 1 |
| fault_stearing_groaning_whining_low_power_stee | 1 |
| fault_stearing_noise | 1 |
| fault_strut_mount_failure | 1 |
| fault_suspension_and_steering_issues | 39 |
| fault_suspension_arm_fault | 1 |
| fault_thrown_rod | 1 |
| fault_turning_front_end_clicking_bad_cv_axle | 1 |
| fault_universal_joint_failure_or_steering_rack | 5 |
| fault_vacuum_leak | 1 |

## 3. Sensors and tables (real)

| File | Content | Source | Rows |
|---|---|---|---|
| `sensors/gas_sensor_array_uci_drift/gas_sensor_drift.parquet` | e_nose_training | miltongneto/Gas-Sensor-Array-Drift | 13910 |
| `sensors/ev_battery_nasa/cycle_capacity_soh.csv` | ev_soh_training | anirudhkhatry/SOH-prediction-using-NASA-Dataset | 636 |
| `sensors/ev_battery_nasa/discharge_curves_every20th_cycle.parquet` | ev_discharge_curves | anirudhkhatry/SOH-prediction-using-NASA-Dataset | 1983 |
| `sensors/obd/obd2_driving_logs.parquet` | obd_pid_streams | hayatu4islam/Automotive_Diagnostics | 2693824 |
| `sensors/obd/dtc_codes.csv` | dtc_dictionary | mytrile/obd-trouble-codes |  |
| `sensors/obd/obdex/pids` | dtc_pid_database | foerbsnavi/OBDex |  |
| `tabular/salvage_flood_copart/copart_salvage_lots.parquet` | salvage_damage_age_mileage | rebrowser/copart-dataset | 26144 |
| `tabular/inspection_history_uk_mot/motriskindex-families-2024-v2.csv` | mot_failure_by_age_family | ivitskiy/uk-mot-risk-index-dataset |  |
| `tabular/inspection_history_uk_mot/motriskindex-defect-groups-2024-v2.csv` | mot_failure_by_age_family | ivitskiy/uk-mot-risk-index-dataset |  |
| `tabular/inspection_history_uk_mot/example_cars.csv` | mot_reliability_survival | Nasser-Sanchez/UK-MOT-Reliability-Analysis |  |
| `tabular/inspection_history_uk_mot/batch_0000.parquet` | mot_reliability_survival | Nasser-Sanchez/UK-MOT-Reliability-Analysis |  |
| `tabular/insurance_claims/insurance_claims.csv` | insurance_claim_fraud_vehicle_age | DandiMahendris/Auto-Insurance-Fraud-Detection |  |
| `tabular/malaysia/seven_cities_2025/01_master_dataset/Malaysia_7Cities_master_dataset.xlsx` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/Malaysia_7Cities_Supplementary_Materials/S0_manifest.csv` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/Malaysia_7Cities_Supplementary_Materials/S6_validation_and_reproducibility_notes/Validation_formula_recheck_summary.csv` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/Malaysia_7Cities_Supplementary_Materials/S6_validation_and_reproducibility_notes/Validation_status_counts.csv` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/Malaysia_7Cities_Supplementary_Materials/S4_population_vehicle_background_proxy/S4_raw_population_state_2025_selected.parquet` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/Malaysia_7Cities_Supplementary_Materials/S4_population_vehicle_background_proxy/S4_validation_checks.csv` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/Malaysia_7Cities_Supplementary_Materials/S4_population_vehicle_background_proxy/S4_population_vehicle_indicators_7_cities.xlsx` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/Malaysia_7Cities_Supplementary_Materials/S4_population_vehicle_background_proxy/S4_vehicle_state_2025.csv` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/Malaysia_7Cities_Supplementary_Materials/S4_population_vehicle_background_proxy/S4_city_state_indicators.csv` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/Malaysia_7Cities_Supplementary_Materials/S4_population_vehicle_background_proxy/S4_city_state_matching.csv` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/Malaysia_7Cities_Supplementary_Materials/S4_population_vehicle_background_proxy/S4_raw_vehicles_2025_selected.parquet` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/Malaysia_7Cities_Supplementary_Materials/S4_population_vehicle_background_proxy/S4_validation_summary.csv` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/Malaysia_7Cities_Supplementary_Materials/S4_population_vehicle_background_proxy/S4_population_state_2025.csv` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/Malaysia_7Cities_Supplementary_Materials/S5_figure_source_data_and_analysis_script/Figure6_regime_profile_mean_zscore.csv` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/Malaysia_7Cities_Supplementary_Materials/S5_figure_source_data_and_analysis_script/Figure4_raw_source_data.csv` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/Malaysia_7Cities_Supplementary_Materials/S5_figure_source_data_and_analysis_script/Table3_rechecked_TomTom_traffic_performance.csv` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/Malaysia_7Cities_Supplementary_Materials/S5_figure_source_data_and_analysis_script/Sensitivity_analysis_cluster_summary.csv` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/Malaysia_7Cities_Supplementary_Materials/S5_figure_source_data_and_analysis_script/Figure3_source_data.csv` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/Malaysia_7Cities_Supplementary_Materials/S5_figure_source_data_and_analysis_script/Figure4_zscore_source_data.csv` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/Malaysia_7Cities_Supplementary_Materials/S5_figure_source_data_and_analysis_script/Figure5_direction_adjusted_raw_matrix.csv` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/Malaysia_7Cities_Supplementary_Materials/S5_figure_source_data_and_analysis_script/Sensitivity_analysis_city_assignments.csv` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/Malaysia_7Cities_Supplementary_Materials/S5_figure_source_data_and_analysis_script/Figure6_Ward_linkage_matrix.csv` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/Malaysia_7Cities_Supplementary_Materials/S5_figure_source_data_and_analysis_script/Figure6_clustering_input_9_core_zscores.csv` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/Malaysia_7Cities_Supplementary_Materials/S5_figure_source_data_and_analysis_script/Figure6_regime_assignments.csv` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/Malaysia_7Cities_Supplementary_Materials/S5_figure_source_data_and_analysis_script/Table4_rechecked_network_background_indicators.csv` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/Malaysia_7Cities_Supplementary_Materials/S5_figure_source_data_and_analysis_script/Figure5_zscore_matrix.csv` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/Malaysia_7Cities_Supplementary_Materials/S3_OSM_network_indicators_and_validation/S3_OSM_validation_report_recalibrated.xlsx` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/Malaysia_7Cities_Supplementary_Materials/S3_OSM_network_indicators_and_validation/S3_OSM_road_network_indicators_7_cities_recalibrated.xlsx` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/Malaysia_7Cities_Supplementary_Materials/S1_master_dataset_and_dictionary/S1_Malaysia_7Cities_master_dataset.xlsx` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/Malaysia_7Cities_Supplementary_Materials/S1_master_dataset_and_dictionary/S1_master_dataset.csv` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/Malaysia_7Cities_Supplementary_Materials/S1_master_dataset_and_dictionary/S1_data_dictionary.csv` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/Malaysia_7Cities_Supplementary_Materials/S2_TomTom_FCD_indicators/S2_TomTom_7cities_indicators.xlsx` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/04_population_vehicle/population_vehicle_indicators_7_cities.xlsx` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/04_population_vehicle/raw_vehicles_2025_selected.parquet` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/04_population_vehicle/raw_population_state_2025_selected.parquet` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/03_osm_network/OSM_validation_report_recalibrated.xlsx` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/03_osm_network/OSM_road_network_indicators_7_cities_recalibrated.xlsx` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/03_osm_network/OSM_recalibrated_files_for_paper/OSM_validation_report_recalibrated.xlsx` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/03_osm_network/OSM_recalibrated_files_for_paper/OSM_road_network_indicators_7_cities_recalibrated.xlsx` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/03_osm_network/OSM_recalibrated_files_for_paper/OSM_validation_report_resolved.xlsx` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/03_osm_network/OSM_recalibrated_files_for_paper/OSM_road_network_indicators_7_cities.xlsx` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |
| `tabular/malaysia/seven_cities_2025/02_tomtom_input/TomTom_7cities_indicators.xlsx` | malaysia_traffic_population_vehicle_registration | tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025 |  |

## 4. Synthetic (fictional, calibrated to real data)

| File | Content |
|---|---|
| `synthetic/vehicles.parquet` | 5,000 fictional vehicles: make/model/usage/fuel/euro class/state/odometer + hidden ground-truth flags (flood, DPF tamper, SCR fault, odometer rollback, engine swap, structural repair, BER, EV SOH) |
| `synthetic/inspections.parquet` | 13,866 inspections over 3 years: every lane measurement, OBD codes, PN, EV SOH/HV isolation, corrosion score, fail reasons, examiner, branch, duration |
| `synthetic/insurance_policies.parquet / insurance_claims.parquet` | Policy (insurer, NCD, sum insured, flood add-on) and 3,746 claims incl. flood events and BER total losses |
| `synthetic/acoustic_fingerprints.parquet` | 32-dim engine-sound embedding per inspection visit (engine swaps injected) |
| `synthetic/bookings_daily.parquet` | Daily demand vs capacity per branch 2024-2026, festive dips, GEAR premium slots, no-shows |
| `synthetic/lane_equipment_telemetry.parquet` | Daily vibration/temperature/calibration per device; one drifting roller tester |
| `synthetic/remote_sensing_roadside.parquet` | 3,000 roadside plume readings with high-emitter flags |
| `synthetic/examiners.csv` | 80 fictional examiners; 2 integrity outliers |
| `synthetic/branches.csv` | 20 illustrative branches (replace with official list) |
| `synthetic/calibration_*.csv` | Real calibration inputs: JPJ 2025 state and category mix, UK MOT defect mix |

## 5. Demo sessions

`sessions/S1..S6.json` hold the vehicle, injected faults, expected AI outputs and references to real images and audio. `sessions/streams/S#/` holds real-time streams (e-nose 16 ch at 2 Hz, OBD at 1 Hz, PN at 1 Hz, brake-roller curves, thermal, EV BMS). `enose_signature_library.json` maps each condition to a real UCI gas-class signature used as a proxy.

## 6. Live web data

`web_live/fetch_live.py` polls data.gov.my (fuel price, weather forecast per branch town, weather warnings, JPS flood stations, vehicle registration parquet) and the daily Copart repo. `web_live/snapshots_2026-09-24/` holds the snapshots captured today.

## 7. Known gaps (be honest in the demo)

- **Flood-damaged vehicle photos:** only 2 usable reference photos found on GitHub. Needs Kaggle/Roboflow sets (see README) or partner-workshop photos.
- **Vehicle undercarriage corrosion:** 137 real corrosion photos are industrial metal, not vehicle underbodies. Fine-tune on workshop photos (200-300 planned in the build plan).
- **Several DB1 fault sound classes have only 1-2 clips.** Enough to demo, not to claim accuracy.
- **E-nose vehicle data does not exist publicly.** Streams are synthetic, shaped by real gas-sensor signatures (proxy, documented).
- **PN, thermal, HV isolation, lane instruments** are synthetic.
- **Branch list is illustrative;** the official list loads by JavaScript on puspakom.com.my.
