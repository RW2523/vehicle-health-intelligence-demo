# Licences and sources

Every curated file traces to a public GitHub repository (see `manifest.csv` for the per-file original path).
Repos with **no declared licence** are usable for this internal, non-commercial concept demo only. Before any commercial or production use, obtain permission or replace them with licensed data.

| Source repository | Licence | Files | Domains |
|---|---|---|---|
| [AspectParadox-dev/Car-Damage-Evaluation](https://github.com/AspectParadox-dev/Car-Damage-Evaluation) | none declared - demo/research use only, verify before commercial use | 1080 | vehicle_damage |
| [Arsalanzabeeb786/Tyre-Helath-Quality-Prediction](https://github.com/Arsalanzabeeb786/Tyre-Helath-Quality-Prediction) | none declared - demo/research use only, verify before commercial use | 900 | tyre |
| [KaroDievas/car-sound-classification-with-keras](https://github.com/KaroDievas/car-sound-classification-with-keras) | MIT | 585 | audio |
| [AwaisSabit/Car-Engine-Sounds-Dataset](https://github.com/AwaisSabit/Car-Engine-Sounds-Dataset) | none declared - demo/research use only, verify before commercial use | 507 | audio |
| [iNusz/Malaysia_LicensePlate](https://github.com/iNusz/Malaysia_LicensePlate) | none declared - demo/research use only, verify before commercial use | 500 | plates_my |
| [amrrashed/Sound-Based-Vehicle-Diagnostics-Emergency-Signal-Recognition](https://github.com/amrrashed/Sound-Based-Vehicle-Diagnostics-Emergency-Signal-Recognition) | none declared - demo/research use only, verify before commercial use | 249 | audio |
| [krishnapriya-nynaru/Industrial-Corrosion-Detection-YOLOv11](https://github.com/krishnapriya-nynaru/Industrial-Corrosion-Detection-YOLOv11) | MIT | 137 | corrosion |
| [dxlabskku/TQVCD](https://github.com/dxlabskku/TQVCD) | none declared - demo/research use only, verify before commercial use | 120 | vehicle_damage |
| [Nexlson/Malaysia_License_Plate_Generator](https://github.com/Nexlson/Malaysia_License_Plate_Generator) | MIT | 120 | plates_my |
| [Sehba1/Malaysian-License-Plate-Recognition-State-Identification-System](https://github.com/Sehba1/Malaysian-License-Plate-Recognition-State-Identification-System) | none declared - demo/research use only, verify before commercial use | 97 | plates_my |
| [nicolasmetallo/car-damage-detector](https://github.com/nicolasmetallo/car-damage-detector) | MIT | 78 | vehicle_damage |
| [Oleksy1121/Car-damage-detection](https://github.com/Oleksy1121/Car-damage-detection) | none declared - demo/research use only, verify before commercial use | 42 | vehicle_damage |
| [tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025](https://github.com/tasadapullo-svg/Malaysia-7Cities-Traffic-Master-Dataset-2025) | none declared - demo/research use only, verify before commercial use | 42 | tabular |
| [afeefabubakar/License-Plate-Detection-with-OpenCV](https://github.com/afeefabubakar/License-Plate-Detection-with-OpenCV) | MIT | 28 | plates_my |
| [umerforsure/Car-Damage-Detection](https://github.com/umerforsure/Car-Damage-Detection) | MIT | 26 | vehicle_damage |
| [artem111-oss/car-diagnosis](https://github.com/artem111-oss/car-diagnosis) | MIT | 5 | audio |
| [wisetrue95/Tire](https://github.com/wisetrue95/Tire) | none declared - demo/research use only, verify before commercial use | 4 | tyre |
| [ELindberg13/Flood_Depths](https://github.com/ELindberg13/Flood_Depths) | none declared - demo/research use only, verify before commercial use | 2 | flood |
| [Nasser-Sanchez/UK-MOT-Reliability-Analysis](https://github.com/Nasser-Sanchez/UK-MOT-Reliability-Analysis) | none declared - demo/research use only, verify before commercial use | 2 | tabular |
| [ivitskiy/uk-mot-risk-index-dataset](https://github.com/ivitskiy/uk-mot-risk-index-dataset) | CC BY 4.0 (DVSA open data, per README) | 2 | tabular |
| [anirudhkhatry/SOH-prediction-using-NASA-Dataset](https://github.com/anirudhkhatry/SOH-prediction-using-NASA-Dataset) | none declared - demo/research use only, verify before commercial use | 2 | sensors |
| [DandiMahendris/Auto-Insurance-Fraud-Detection](https://github.com/DandiMahendris/Auto-Insurance-Fraud-Detection) | none declared - demo/research use only, verify before commercial use | 1 | tabular |
| [hayatu4islam/Automotive_Diagnostics](https://github.com/hayatu4islam/Automotive_Diagnostics) | none declared - demo/research use only, verify before commercial use | 1 | sensors |
| [foerbsnavi/OBDex](https://github.com/foerbsnavi/OBDex) | CC0 data / MIT tooling (per README) | 1 | sensors |
| [miltongneto/Gas-Sensor-Array-Drift](https://github.com/miltongneto/Gas-Sensor-Array-Drift) | none declared - demo/research use only, verify before commercial use | 1 | sensors |
| [mytrile/obd-trouble-codes](https://github.com/mytrile/obd-trouble-codes) | MIT | 1 | sensors |
| [rebrowser/copart-dataset](https://github.com/rebrowser/copart-dataset) | none declared - demo/research use only, verify before commercial use | 1 | tabular |

**Live web data:** api.data.gov.my (Malaysian Government Open Data, Open Data Licence - attribute data.gov.my). Snapshots in `web_live/`.
**Synthetic data:** generated by `scripts/gen_synthetic.py` and `scripts/gen_sessions.py` - fictional, no personal data. Demo plates use the reserved-looking prefix `DMO`.
**Real plate photos** in `images/plates_my/` show real vehicles: use for ANPR training only, never display them on demo screens as a customer vehicle.

<!-- stock-photos:start -->

## Stock photos

`images/stock/` holds representative photos of the ten main vehicles' models and of generic scenes, from [Wikimedia Commons](https://commons.wikimedia.org/). They show the model, not the fictional vehicle. Only public domain, CC0, CC BY and CC BY-SA files are used; each is credited in the app next to the photo. CC BY-SA photos that are cropped or resized are shared under the same licence. Fetched with `scripts/fetch_stock_images.py --picks` (the list is `images/stock/picks.json`, the metadata `images/stock/manifest.json`).

| File | Used for | Source | Author | Licence |
|---|---|---|---|---|
| `dmo-9001/hero.jpg` | DMO 9001 · hero | [File:SCANIA XT P410 Series (Infiniti Marine) 0225.jpg](https://commons.wikimedia.org/wiki/File:SCANIA_XT_P410_Series_(Infiniti_Marine)_0225.jpg) | 33Loading | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `dmo-9002/hero.jpg` | DMO 9002 · hero | [File:BYD ATTO 3 in Brisbane, Australia, 2022, 03.jpg](https://commons.wikimedia.org/wiki/File:BYD_ATTO_3_in_Brisbane,_Australia,_2022,_03.jpg) | Kgbo | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `dmo-9002/rear.jpg` | DMO 9002 · rear | [File:BYD ATTO 3 in Brisbane, Australia, 2022, 04.jpg](https://commons.wikimedia.org/wiki/File:BYD_ATTO_3_in_Brisbane,_Australia,_2022,_04.jpg) | Kgbo | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `dmo-9002/interior.jpg` | DMO 9002 · interior | [File:BYD Atto 3, 2023, Japan, interior.jpg](https://commons.wikimedia.org/wiki/File:BYD_Atto_3,_2023,_Japan,_interior.jpg) | Kazyakuruma | [CC0](http://creativecommons.org/publicdomain/zero/1.0/deed.en) |
| `dmo-9003/hero.jpg` | DMO 9003 · hero | [File:Honda CIVIC SEDAN (DBA-FC1) front.jpg](https://commons.wikimedia.org/wiki/File:Honda_CIVIC_SEDAN_(DBA-FC1)_front.jpg) | Tokumeigakarinoaoshima | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `dmo-9003/rear.jpg` | DMO 9003 · rear | [File:Honda CIVIC SEDAN (DBA-FC1) rear.jpg](https://commons.wikimedia.org/wiki/File:Honda_CIVIC_SEDAN_(DBA-FC1)_rear.jpg) | Tokumeigakarinoaoshima | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `dmo-9003/interior.jpg` | DMO 9003 · interior | [File:Honda CIVIC SEDAN (DBA-FC1) interior.jpg](https://commons.wikimedia.org/wiki/File:Honda_CIVIC_SEDAN_(DBA-FC1)_interior.jpg) | Tokumeigakarinoaoshima | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `dmo-9003/tyre.jpg` | DMO 9003 · tyre | [File:The tire wheel of Honda CIVIC SEDAN (DBA-FC1).jpg](https://commons.wikimedia.org/wiki/File:The_tire_wheel_of_Honda_CIVIC_SEDAN_(DBA-FC1).jpg) | Tokumeigakarinoaoshima | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `dmo-9003/engine.jpg` | DMO 9003 · engine | [File:2016 Honda Civic 1.5 ES FC1 L15B7 engine (20160409).jpg](https://commons.wikimedia.org/wiki/File:2016_Honda_Civic_1.5_ES_FC1_L15B7_engine_(20160409).jpg) | オーバードライブ83 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `dmo-9006/hero.jpg` | DMO 9006 · hero | [File:2021 Perodua Myvi 1.3G silver front view in Brunei.jpg](https://commons.wikimedia.org/wiki/File:2021_Perodua_Myvi_1.3G_silver_front_view_in_Brunei.jpg) | AIMHO'S REBELLION 8490s | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `dmo-9006/rear.jpg` | DMO 9006 · rear | [File:2021 Perodua Myvi 1.3G silver rear view in Brunei.jpg](https://commons.wikimedia.org/wiki/File:2021_Perodua_Myvi_1.3G_silver_rear_view_in_Brunei.jpg) | AIMHO'S REBELLION 8490s | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `dmo-9006/interior.jpg` | DMO 9006 · interior | [File:2021 Perodua Myvi 1.3G silver interior view in Brunei.jpg](https://commons.wikimedia.org/wiki/File:2021_Perodua_Myvi_1.3G_silver_interior_view_in_Brunei.jpg) | AIMHO'S REBELLION 8490s | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `vjm-7412/hero.jpg` | VJM 7412 · hero | [File:2021 Perodua Bezza 1.0 GXtra silver bodykit front view in Brunei.jpg](https://commons.wikimedia.org/wiki/File:2021_Perodua_Bezza_1.0_GXtra_silver_bodykit_front_view_in_Brunei.jpg) | AIMHO'S REBELLION 8490s | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `vjm-7412/rear.jpg` | VJM 7412 · rear | [File:2021 Perodua Bezza 1.0 GXtra silver bodykit rear view in Brunei.jpg](https://commons.wikimedia.org/wiki/File:2021_Perodua_Bezza_1.0_GXtra_silver_bodykit_rear_view_in_Brunei.jpg) | AIMHO'S REBELLION 8490s | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `vjm-7412/side.jpg` | VJM 7412 · side | [File:(Rear) 2020 Perodua Bezza 1.0 G.jpg](https://commons.wikimedia.org/wiki/File:(Rear)_2020_Perodua_Bezza_1.0_G.jpg) | Aaront1059 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `vjm-7412/interior.jpg` | VJM 7412 · interior | [File:2021 Perodua Bezza 1.0 GXtra red interior view in Brunei.jpg](https://commons.wikimedia.org/wiki/File:2021_Perodua_Bezza_1.0_GXtra_red_interior_view_in_Brunei.jpg) | AIMHO'S REBELLION 8490s | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `wxd-2291/hero.jpg` | WXD 2291 · hero | [File:2018 Ford Ranger (PX) XLT 4WD 4-door utility (2018-10-22) 01.jpg](https://commons.wikimedia.org/wiki/File:2018_Ford_Ranger_(PX)_XLT_4WD_4-door_utility_(2018-10-22)_01.jpg) | EurovisionNim | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `wxd-2291/rear.jpg` | WXD 2291 · rear | [File:2018 Ford Ranger (PX) XLT 4WD 4-door utility (2018-10-22) 02.jpg](https://commons.wikimedia.org/wiki/File:2018_Ford_Ranger_(PX)_XLT_4WD_4-door_utility_(2018-10-22)_02.jpg) | EurovisionNim | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `wxd-2291/interior.jpg` | WXD 2291 · interior | [File:2019 Ford Ranger Raptor Double Cab 2.0 Interior.jpg](https://commons.wikimedia.org/wiki/File:2019_Ford_Ranger_Raptor_Double_Cab_2.0_Interior.jpg) | Vauxford | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `bhy-7783/hero.jpg` | BHY 7783 · hero | [File:2017 Toyota HiAce (TRH201R) LWB van (2018-10-01) 01.jpg](https://commons.wikimedia.org/wiki/File:2017_Toyota_HiAce_(TRH201R)_LWB_van_(2018-10-01)_01.jpg) | EurovisionNim | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `bhy-7783/rear.jpg` | BHY 7783 · rear | [File:2017 Toyota HiAce (TRH201R) LWB van (2018-10-01) 02.jpg](https://commons.wikimedia.org/wiki/File:2017_Toyota_HiAce_(TRH201R)_LWB_van_(2018-10-01)_02.jpg) | EurovisionNim | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `bhy-7783/interior.jpg` | BHY 7783 · interior | [File:Toyota HIACE Relaxbase TYPE 1 S-GL (CBF-TRH200V-WVMXTE) interior.jpg](https://commons.wikimedia.org/wiki/File:Toyota_HIACE_Relaxbase_TYPE_1_S-GL_(CBF-TRH200V-WVMXTE)_interior.jpg) | Tokumeigakarinoaoshima | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `vkr-3128/hero.jpg` | VKR 3128 · hero | [File:2021 Toyota Vios 1.5J MT Super White front view in Brunei.jpg](https://commons.wikimedia.org/wiki/File:2021_Toyota_Vios_1.5J_MT_Super_White_front_view_in_Brunei.jpg) | AIMHO'S REBELLION 8490s | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `vkr-3128/rear.jpg` | VKR 3128 · rear | [File:Toyota Vios NSP151 G Prime White Pearl - rear.jpg](https://commons.wikimedia.org/wiki/File:Toyota_Vios_NSP151_G_Prime_White_Pearl_-_rear.jpg) | Ethan Llamas | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `vkr-3128/interior.jpg` | VKR 3128 · interior | [File:2021 Toyota Vios 1.5J MT Super White interior view in Brunei.jpg](https://commons.wikimedia.org/wiki/File:2021_Toyota_Vios_1.5J_MT_Super_White_interior_view_in_Brunei.jpg) | AIMHO'S REBELLION 8490s | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `pke-4410/hero.jpg` | PKE 4410 · hero | [File:2021 Toyota Kijang Innova 2.0 V Luxury (front), Citraland, West Surabaya.jpg](https://commons.wikimedia.org/wiki/File:2021_Toyota_Kijang_Innova_2.0_V_Luxury_(front),_Citraland,_West_Surabaya.jpg) | Alex Neman | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `pke-4410/rear.jpg` | PKE 4410 · rear | [File:2021 Toyota Kijang Innova 2.0 V Luxury (rear), Citraland, West Surabaya.jpg](https://commons.wikimedia.org/wiki/File:2021_Toyota_Kijang_Innova_2.0_V_Luxury_(rear),_Citraland,_West_Surabaya.jpg) | Alex Neman | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `pke-4410/interior.jpg` | PKE 4410 · interior | [File:2021 Toyota Innova 2.4G diesel 6AT grey interior view in Brunei.jpg](https://commons.wikimedia.org/wiki/File:2021_Toyota_Innova_2.4G_diesel_6AT_grey_interior_view_in_Brunei.jpg) | AIMHO'S REBELLION 8490s | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `jtr-5510/hero.jpg` | JTR 5510 · hero | [File:Nissan NV350 Urvan 2.5 Premium 2020 (2).jpg](https://commons.wikimedia.org/wiki/File:Nissan_NV350_Urvan_2.5_Premium_2020_(2).jpg) | Ethan Llamas | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) |
| `jtr-5510/rear.jpg` | JTR 5510 · rear | [File:Nissan NV350 CARAVAN WAGON Rider GX (3BA-KS2E26) rear.jpg](https://commons.wikimedia.org/wiki/File:Nissan_NV350_CARAVAN_WAGON_Rider_GX_(3BA-KS2E26)_rear.jpg) | Tokumeigakarinoaoshima | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `jtr-5510/side.jpg` | JTR 5510 · side | [File:Nissan NV350 Urvan 2.5 15-Seater 2019.jpg](https://commons.wikimedia.org/wiki/File:Nissan_NV350_Urvan_2.5_15-Seater_2019.jpg) | Ethan Llamas | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `jtr-5510/interior.jpg` | JTR 5510 · interior | [File:Nissan NV350 CARAVAN PREMIUM GX (LDF-VW2E26) interior.jpg](https://commons.wikimedia.org/wiki/File:Nissan_NV350_CARAVAN_PREMIUM_GX_(LDF-VW2E26)_interior.jpg) | Tokumeigakarinoaoshima | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `scenes/hub.jpg` | Scene · hub | [File:Former vehicle inspection station, Lafitte St, New Orleans 10 June 2025 - 2.jpg](https://commons.wikimedia.org/wiki/File:Former_vehicle_inspection_station,_Lafitte_St,_New_Orleans_10_June_2025_-_2.jpg) | Infrogmation | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `scenes/lane.jpg` | Scene · lane | [File:Car brake test.jpg](https://commons.wikimedia.org/wiki/File:Car_brake_test.jpg) | ProjectManhattan | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) |
| `scenes/pit.jpg` | Scene · pit | [File:Inspection pits in Presidio Division (2), March 2026.jpg](https://commons.wikimedia.org/wiki/File:Inspection_pits_in_Presidio_Division_(2),_March_2026.jpg) | Pi.1415926535 | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `scenes/flood.jpg` | Scene · flood | [File:Flooded Section 24 Residential Area Park.jpg](https://commons.wikimedia.org/wiki/File:Flooded_Section_24_Residential_Area_Park.jpg) | Muhammad Zaim | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) |
| `scenes/tyre.jpg` | Scene · tyre | [File:Tire tread .jpg](https://commons.wikimedia.org/wiki/File:Tire_tread_.jpg) | Jbobby | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0) |
| `scenes/login.jpg` | Scene · login | [File:LDP 25.jpg](https://commons.wikimedia.org/wiki/File:LDP_25.jpg) | Slleong | [CC0](http://creativecommons.org/publicdomain/zero/1.0/deed.en) |

<!-- stock-photos:end -->
