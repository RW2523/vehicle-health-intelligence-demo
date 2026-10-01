# Image prompts

One photoreal text-to-image prompt per image slot of the ten main vehicles and the generic scenes. The prompts match the sample inspection images (bright Malaysian inspection hall, epoxy floor with yellow lane lines, camera gantries) and each vehicle's make, model, year and paint. Number plates are the fictional demo plates in Malaysian style (white characters on a black plate).

**To use an image:** upload it in **Settings → Images** (it replaces the stock photo straight away), or save it on the API server as the path given (any size, JPEG/PNG/WebP; the API makes the 1600/960/480 px copies). Deleting the upload brings the stock photo back.

## DMO 9001 · 2022 Scania P-Series Prime Mover · white

### `dmo-9001.hero` · Front three-quarter

- **Shows in:** Vehicle Records (list card and vehicle page header), Dashboard lane and queue cards, Inspection Management; Live Lane (lane replay)
- **Aspect ratio:** 4:3
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/dmo-9001/hero.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Front three-quarter view from the front left of a 2022 Scania P-series prime mover (new-generation Scania P-series 6x2 tractor unit with the low day cab) in white paint (a working haulage tractor unit, clean but used, no trailer attached, fifth-wheel coupling and twin rear axles visible, black bumper and dark-grey chassis), on the heavy-vehicle inspection lane, its front axle on a heavy-vehicle roller brake tester set into the floor, inside a modern Malaysian vehicle inspection centre: bright high-bay LED strip lighting mixed with soft tropical daylight from tall windows and open roller-shutter doors (palm trees and an overcast sky outside), a light-grey polished epoxy floor with yellow lane lines and black steel floor gratings, slim steel camera gantries with inspection cameras on both sides of the lane. Malaysian number plate reading “DMO 9001” in white characters on a black plate on the front bumper. Camera at 1.3 m height, about 6 m from the vehicle, 35 mm lens, f/5.6, the whole vehicle in frame with a little floor around it. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `dmo-9001.rear` · Rear three-quarter

- **Shows in:** Vehicle page photo gallery
- **Aspect ratio:** 4:3
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/dmo-9001/rear.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Rear three-quarter view of a 2022 Scania P-series prime mover (new-generation Scania P-series 6x2 tractor unit with the low day cab) in white paint (a working haulage tractor unit, clean but used, no trailer attached, fifth-wheel coupling and twin rear axles visible, black bumper and dark-grey chassis), showing the fifth-wheel coupling, air and electrical trailer connections, mudguards and twin rear axles, parked in the exit bay of the inspection lane inside a modern Malaysian vehicle inspection centre: bright high-bay LED strip lighting mixed with soft tropical daylight from tall windows and open roller-shutter doors (palm trees and an overcast sky outside), a light-grey polished epoxy floor with yellow lane lines and black steel floor gratings, slim steel camera gantries with inspection cameras on both sides of the lane. Malaysian number plate reading “DMO 9001” in white characters on a black plate on the rear. Camera at 1.3 m height, 35 mm lens, f/5.6, whole vehicle in frame. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `dmo-9001.side` · Side profile

- **Shows in:** Vehicle page photo gallery and the inspection report cover
- **Aspect ratio:** 16:9
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/dmo-9001/side.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Side view of a 2022 Scania P-series prime mover (new-generation Scania P-series 6x2 tractor unit with the low day cab) in white paint (a working haulage tractor unit, clean but used, no trailer attached, fifth-wheel coupling and twin rear axles visible, black bumper and dark-grey chassis): a long side profile showing the low day cab, fuel tank, exhaust after-treatment box and both rear axles, parked in the outdoor marshalling yard of a Malaysian vehicle inspection centre: wet dark tarmac after a tropical shower, painted bay lines, the inspection hall's grey cladding and open roller shutters behind, palm trees and a bright overcast sky. Malaysian number plate reading “DMO 9001” in white characters on a black plate visible at the front and rear edges. Camera at 1.2 m height, perpendicular to the vehicle, 50 mm lens, f/8, soft diffuse daylight. 16:9 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `dmo-9001.interior` · Cab

- **Shows in:** Vehicle page photo gallery (cabin)
- **Aspect ratio:** 4:3
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/dmo-9001/interior.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Interior photo: driver's cab of a 2022 Scania P-series, right-hand drive: wraparound dashboard with digital instrument cluster, multifunction steering wheel, gear selector stalk, grey fabric air-suspended seat, view from the open driver's door. The vehicle is a 2022 Scania P-series prime mover (new-generation Scania P-series 6x2 tractor unit with the low day cab) in white paint (a sliver of the paint visible on the door frame), parked inside a modern Malaysian vehicle inspection centre with the lane lights visible through the windscreen. If a number plate is in frame it is the Malaysian number plate reading “DMO 9001” in white characters on a black plate. 24 mm lens, f/4, even soft light, slightly lifted shadows, realistic everyday wear. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `dmo-9001.underbody` · Underbody

- **Shows in:** Inspection Management → Undercarriage AI reference and the vehicle page gallery
- **Aspect ratio:** 4:3
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/dmo-9001/underbody.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. View from inside an inspection pit looking up at the underside of a 2022 Scania P-series prime mover (new-generation Scania P-series 6x2 tractor unit with the low day cab) in white paint (a working haulage tractor unit, clean but used, no trailer attached, fifth-wheel coupling and twin rear axles visible, black bumper and dark-grey chassis): the tractor unit's chassis rails, air brake chambers, drive-axle differentials, exhaust after-treatment box and air lines, lit by the pit's LED strips, dusty from daily haulage. Clean concrete pit walls with recessed LED strip lights and a yellow safety edge, the lane floor gratings framing the shot. If a number plate is in frame it is the Malaysian number plate reading “DMO 9001” in white characters on a black plate. 16 mm wide-angle lens, f/5.6, bright even LED light, sharp detail. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `dmo-9001.tyre` · Tyre close-up

- **Shows in:** Inspection Management → Tyre AI reference and the vehicle page gallery
- **Aspect ratio:** 1:1
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/dmo-9001/tyre.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Close-up of the front steer tyre (315/80 R22.5 truck tyre on a steel wheel) with deep tread grooves; an examiner's gloved hand holds a tread depth gauge in a groove. The vehicle is a 2022 Scania P-series prime mover (new-generation Scania P-series 6x2 tractor unit with the low day cab) in white paint (a working haulage tractor unit, clean but used, no trailer attached, fifth-wheel coupling and twin rear axles visible, black bumper and dark-grey chassis), standing on the roller brake tester of an inspection lane, grey epoxy floor and yellow lines out of focus behind. If a number plate is in frame it is the Malaysian number plate reading “DMO 9001” in white characters on a black plate. Camera low at wheel-hub height, 70 mm lens, f/4, soft LED light raking across the tread to show its depth. 1:1 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `dmo-9001.engine` · Engine (cab tilted)

- **Shows in:** Vehicle page photo gallery (engine bay)
- **Aspect ratio:** 4:3
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/dmo-9001/engine.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Engine compartment of a 2022 Scania P-series prime mover (new-generation Scania P-series 6x2 tractor unit with the low day cab) in white paint (a working haulage tractor unit, clean but used, no trailer attached, fifth-wheel coupling and twin rear axles visible, black bumper and dark-grey chassis): the cab tilted fully forward to show the inline six-cylinder diesel engine, turbocharger, coolant expansion tank and wiring, inside a modern Malaysian vehicle inspection centre; camera in front of the tilted cab at 1.6 m height looking at the engine, 28 mm lens, f/8, even light, realistic grime for its age. If a number plate is in frame it is the Malaysian number plate reading “DMO 9001” in white characters on a black plate. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

## DMO 9002 · 2022 BYD Atto 3 · Surf Blue

### `dmo-9002.hero` · Front three-quarter

- **Shows in:** Vehicle Records (list card and vehicle page header), Dashboard lane and queue cards, Inspection Management; Live Lane (lane replay)
- **Aspect ratio:** 4:3
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/dmo-9002/hero.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Front three-quarter view from the front left of a 2022 BYD Atto 3 compact electric SUV in Surf Blue paint (slim LED headlamps joined by a chrome strip across the closed-off front, silver C-pillar trim, 18-inch two-tone alloy wheels, no exhaust pipe), on an inspection lane, front wheels on the roller brake tester, inside a modern Malaysian vehicle inspection centre: bright high-bay LED strip lighting mixed with soft tropical daylight from tall windows and open roller-shutter doors (palm trees and an overcast sky outside), a light-grey polished epoxy floor with yellow lane lines and black steel floor gratings, slim steel camera gantries with inspection cameras on both sides of the lane. Malaysian number plate reading “DMO 9002” in white characters on a black plate on the front bumper. Camera at 1.3 m height, about 6 m from the vehicle, 35 mm lens, f/5.6, the whole vehicle in frame with a little floor around it. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `dmo-9002.rear` · Rear three-quarter

- **Shows in:** Vehicle page photo gallery
- **Aspect ratio:** 4:3
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/dmo-9002/rear.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Rear three-quarter view of a 2022 BYD Atto 3 compact electric SUV in Surf Blue paint (slim LED headlamps joined by a chrome strip across the closed-off front, silver C-pillar trim, 18-inch two-tone alloy wheels, no exhaust pipe), showing the full-width light bar on the tailgate and the roof spoiler, parked in the exit bay of the inspection lane inside a modern Malaysian vehicle inspection centre: bright high-bay LED strip lighting mixed with soft tropical daylight from tall windows and open roller-shutter doors (palm trees and an overcast sky outside), a light-grey polished epoxy floor with yellow lane lines and black steel floor gratings, slim steel camera gantries with inspection cameras on both sides of the lane. Malaysian number plate reading “DMO 9002” in white characters on a black plate on the rear. Camera at 1.3 m height, 35 mm lens, f/5.6, whole vehicle in frame. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `dmo-9002.side` · Side profile

- **Shows in:** Vehicle page photo gallery and the inspection report cover
- **Aspect ratio:** 16:9
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/dmo-9002/side.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Side view of a 2022 BYD Atto 3 compact electric SUV in Surf Blue paint (slim LED headlamps joined by a chrome strip across the closed-off front, silver C-pillar trim, 18-inch two-tone alloy wheels, no exhaust pipe): a clean side profile showing the silver C-pillar trim and the charging flap on the front wing, parked in the outdoor marshalling yard of a Malaysian vehicle inspection centre: wet dark tarmac after a tropical shower, painted bay lines, the inspection hall's grey cladding and open roller shutters behind, palm trees and a bright overcast sky. Malaysian number plate reading “DMO 9002” in white characters on a black plate visible at the front and rear edges. Camera at 1.2 m height, perpendicular to the vehicle, 50 mm lens, f/8, soft diffuse daylight. 16:9 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `dmo-9002.interior` · Cabin

- **Shows in:** Vehicle page photo gallery (cabin)
- **Aspect ratio:** 4:3
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/dmo-9002/interior.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Interior photo: right-hand-drive cabin of a 2022 BYD Atto 3: large rotating central touchscreen, gym-inspired round air vents and door handles, string-style door pockets, blue and off-white two-tone seats, view from the open driver's door. The vehicle is a 2022 BYD Atto 3 compact electric SUV in Surf Blue paint (a sliver of the paint visible on the door frame), parked inside a modern Malaysian vehicle inspection centre with the lane lights visible through the windscreen. If a number plate is in frame it is the Malaysian number plate reading “DMO 9002” in white characters on a black plate. 24 mm lens, f/4, even soft light, slightly lifted shadows, realistic everyday wear. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `dmo-9002.underbody` · Underbody

- **Shows in:** Inspection Management → Undercarriage AI reference and the vehicle page gallery
- **Aspect ratio:** 4:3
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/dmo-9002/underbody.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. View from inside an inspection pit looking up at the underside of a 2022 BYD Atto 3 compact electric SUV in Surf Blue paint (slim LED headlamps joined by a chrome strip across the closed-off front, silver C-pillar trim, 18-inch two-tone alloy wheels, no exhaust pipe): the flat underside of the high-voltage battery pack between the axles, orange high-voltage cables and the rear drive unit; a faint tide line of dried silt along the front edge of the battery pack (possible flood exposure). Clean concrete pit walls with recessed LED strip lights and a yellow safety edge, the lane floor gratings framing the shot. If a number plate is in frame it is the Malaysian number plate reading “DMO 9002” in white characters on a black plate. 16 mm wide-angle lens, f/5.6, bright even LED light, sharp detail. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `dmo-9002.tyre` · Tyre close-up

- **Shows in:** Inspection Management → Tyre AI reference and the vehicle page gallery
- **Aspect ratio:** 1:1
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/dmo-9002/tyre.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Close-up of the front tyre (215/55 R18) on a two-tone 18-inch alloy wheel; an examiner's tread depth gauge rests in a groove. The vehicle is a 2022 BYD Atto 3 compact electric SUV in Surf Blue paint (slim LED headlamps joined by a chrome strip across the closed-off front, silver C-pillar trim, 18-inch two-tone alloy wheels, no exhaust pipe), standing on the roller brake tester of an inspection lane, grey epoxy floor and yellow lines out of focus behind. If a number plate is in frame it is the Malaysian number plate reading “DMO 9002” in white characters on a black plate. Camera low at wheel-hub height, 70 mm lens, f/4, soft LED light raking across the tread to show its depth. 1:1 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `dmo-9002.engine` · Front compartment

- **Shows in:** Vehicle page photo gallery (engine bay)
- **Aspect ratio:** 4:3
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/dmo-9002/engine.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Engine compartment of a 2022 BYD Atto 3 compact electric SUV in Surf Blue paint (slim LED headlamps joined by a chrome strip across the closed-off front, silver C-pillar trim, 18-inch two-tone alloy wheels, no exhaust pipe): the front compartment with the bonnet open: the electric drive unit cover, orange high-voltage cables, 12 V battery and coolant reservoirs, no combustion engine, inside a modern Malaysian vehicle inspection centre; an LED inspection lamp hanging from the bonnet. Camera above the front bumper looking down at 40 degrees, 28 mm lens, f/8, even light, realistic grime for its age. If a number plate is in frame it is the Malaysian number plate reading “DMO 9002” in white characters on a black plate. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

## DMO 9003 · 2016 Honda Civic · red

### `dmo-9003.hero` · Front three-quarter

- **Shows in:** Vehicle Records (list card and vehicle page header), Dashboard lane and queue cards, Inspection Management; Live Lane (lane replay)
- **Aspect ratio:** 4:3
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/dmo-9003/hero.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Front three-quarter view from the front left of a 2016 Honda Civic sedan (10th generation, FC) in red paint (fastback roofline, LED headlamps with a chrome brow, C-shaped LED tail lamps, 17-inch two-tone alloy wheels, a privately owned car in good condition), on an inspection lane, front wheels on the roller brake tester, inside a modern Malaysian vehicle inspection centre: bright high-bay LED strip lighting mixed with soft tropical daylight from tall windows and open roller-shutter doors (palm trees and an overcast sky outside), a light-grey polished epoxy floor with yellow lane lines and black steel floor gratings, slim steel camera gantries with inspection cameras on both sides of the lane. Malaysian number plate reading “DMO 9003” in white characters on a black plate on the front bumper. Camera at 1.3 m height, about 6 m from the vehicle, 35 mm lens, f/5.6, the whole vehicle in frame with a little floor around it. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `dmo-9003.rear` · Rear three-quarter

- **Shows in:** Vehicle page photo gallery
- **Aspect ratio:** 4:3
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/dmo-9003/rear.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Rear three-quarter view of a 2016 Honda Civic sedan (10th generation, FC) in red paint (fastback roofline, LED headlamps with a chrome brow, C-shaped LED tail lamps, 17-inch two-tone alloy wheels, a privately owned car in good condition), showing the C-shaped tail lamps and the boot-lid spoiler lip, parked in the exit bay of the inspection lane inside a modern Malaysian vehicle inspection centre: bright high-bay LED strip lighting mixed with soft tropical daylight from tall windows and open roller-shutter doors (palm trees and an overcast sky outside), a light-grey polished epoxy floor with yellow lane lines and black steel floor gratings, slim steel camera gantries with inspection cameras on both sides of the lane. Malaysian number plate reading “DMO 9003” in white characters on a black plate on the rear. Camera at 1.3 m height, 35 mm lens, f/5.6, whole vehicle in frame. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `dmo-9003.side` · Side profile

- **Shows in:** Vehicle page photo gallery and the inspection report cover
- **Aspect ratio:** 16:9
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/dmo-9003/side.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Side view of a 2016 Honda Civic sedan (10th generation, FC) in red paint (fastback roofline, LED headlamps with a chrome brow, C-shaped LED tail lamps, 17-inch two-tone alloy wheels, a privately owned car in good condition): a clean side profile showing the fastback roofline, parked in the outdoor marshalling yard of a Malaysian vehicle inspection centre: wet dark tarmac after a tropical shower, painted bay lines, the inspection hall's grey cladding and open roller shutters behind, palm trees and a bright overcast sky. Malaysian number plate reading “DMO 9003” in white characters on a black plate visible at the front and rear edges. Camera at 1.2 m height, perpendicular to the vehicle, 50 mm lens, f/8, soft diffuse daylight. 16:9 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `dmo-9003.interior` · Cabin

- **Shows in:** Vehicle page photo gallery (cabin)
- **Aspect ratio:** 4:3
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/dmo-9003/interior.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Interior photo: right-hand-drive cabin of a 2016 Honda Civic: two-tier dashboard, digital instrument cluster lit with the odometer showing, 7-inch touchscreen, CVT gear lever, black leather seats, view from the open driver's door. The vehicle is a 2016 Honda Civic sedan (10th generation, FC) in red paint (a sliver of the paint visible on the door frame), parked inside a modern Malaysian vehicle inspection centre with the lane lights visible through the windscreen. If a number plate is in frame it is the Malaysian number plate reading “DMO 9003” in white characters on a black plate. 24 mm lens, f/4, even soft light, slightly lifted shadows, realistic everyday wear. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `dmo-9003.underbody` · Underbody

- **Shows in:** Inspection Management → Undercarriage AI reference and the vehicle page gallery
- **Aspect ratio:** 4:3
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/dmo-9003/underbody.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. View from inside an inspection pit looking up at the underside of a 2016 Honda Civic sedan (10th generation, FC) in red paint (fastback roofline, LED headlamps with a chrome brow, C-shaped LED tail lamps, 17-inch two-tone alloy wheels, a privately owned car in good condition): the front and rear subframes, exhaust with catalytic converter and silencer, fuel tank and rear multi-link suspension, clean and dry. Clean concrete pit walls with recessed LED strip lights and a yellow safety edge, the lane floor gratings framing the shot. If a number plate is in frame it is the Malaysian number plate reading “DMO 9003” in white characters on a black plate. 16 mm wide-angle lens, f/5.6, bright even LED light, sharp detail. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `dmo-9003.tyre` · Tyre close-up

- **Shows in:** Inspection Management → Tyre AI reference and the vehicle page gallery
- **Aspect ratio:** 1:1
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/dmo-9003/tyre.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Close-up of the front tyre (215/50 R17) on a two-tone 17-inch alloy wheel; an examiner's tread depth gauge rests in a groove. The vehicle is a 2016 Honda Civic sedan (10th generation, FC) in red paint (fastback roofline, LED headlamps with a chrome brow, C-shaped LED tail lamps, 17-inch two-tone alloy wheels, a privately owned car in good condition), standing on the roller brake tester of an inspection lane, grey epoxy floor and yellow lines out of focus behind. If a number plate is in frame it is the Malaysian number plate reading “DMO 9003” in white characters on a black plate. Camera low at wheel-hub height, 70 mm lens, f/4, soft LED light raking across the tread to show its depth. 1:1 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `dmo-9003.engine` · Engine bay

- **Shows in:** Vehicle page photo gallery (engine bay)
- **Aspect ratio:** 4:3
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/dmo-9003/engine.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Engine compartment of a 2016 Honda Civic sedan (10th generation, FC) in red paint (fastback roofline, LED headlamps with a chrome brow, C-shaped LED tail lamps, 17-inch two-tone alloy wheels, a privately owned car in good condition): the engine bay with the bonnet open: the 1.5-litre VTEC Turbo four-cylinder engine under its black plastic cover, coolant and brake fluid reservoirs, the chassis-number area on the bulkhead (stamping not legible), inside a modern Malaysian vehicle inspection centre; an LED inspection lamp hanging from the bonnet. Camera above the front bumper looking down at 40 degrees, 28 mm lens, f/8, even light, realistic grime for its age. If a number plate is in frame it is the Malaysian number plate reading “DMO 9003” in white characters on a black plate. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

## DMO 9006 · 2019 Perodua Myvi · silver

### `dmo-9006.hero` · Front three-quarter

- **Shows in:** Vehicle Records (list card and vehicle page header), Dashboard lane and queue cards, Inspection Management; Live Lane (lane replay) and the Mobile app home (the owner's car)
- **Aspect ratio:** 4:3
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/dmo-9006/hero.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Front three-quarter view from the front left of a 2019 Perodua Myvi (third generation) five-door hatchback in silver paint (LED headlamps, black grille with a chrome strip, 15-inch alloy wheels, small roof spoiler, a privately owned car, clean and well kept), on an inspection lane, front wheels on the roller brake tester, inside a modern Malaysian vehicle inspection centre: bright high-bay LED strip lighting mixed with soft tropical daylight from tall windows and open roller-shutter doors (palm trees and an overcast sky outside), a light-grey polished epoxy floor with yellow lane lines and black steel floor gratings, slim steel camera gantries with inspection cameras on both sides of the lane. Malaysian number plate reading “DMO 9006” in white characters on a black plate on the front bumper. Camera at 1.3 m height, about 6 m from the vehicle, 35 mm lens, f/5.6, the whole vehicle in frame with a little floor around it. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `dmo-9006.rear` · Rear three-quarter

- **Shows in:** Vehicle page photo gallery
- **Aspect ratio:** 4:3
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/dmo-9006/rear.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Rear three-quarter view of a 2019 Perodua Myvi (third generation) five-door hatchback in silver paint (LED headlamps, black grille with a chrome strip, 15-inch alloy wheels, small roof spoiler, a privately owned car, clean and well kept), showing the vertical tail lamps and the roof spoiler, parked in the exit bay of the inspection lane inside a modern Malaysian vehicle inspection centre: bright high-bay LED strip lighting mixed with soft tropical daylight from tall windows and open roller-shutter doors (palm trees and an overcast sky outside), a light-grey polished epoxy floor with yellow lane lines and black steel floor gratings, slim steel camera gantries with inspection cameras on both sides of the lane. Malaysian number plate reading “DMO 9006” in white characters on a black plate on the rear. Camera at 1.3 m height, 35 mm lens, f/5.6, whole vehicle in frame. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `dmo-9006.side` · Side profile

- **Shows in:** Vehicle page photo gallery and the inspection report cover
- **Aspect ratio:** 16:9
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/dmo-9006/side.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Side view of a 2019 Perodua Myvi (third generation) five-door hatchback in silver paint (LED headlamps, black grille with a chrome strip, 15-inch alloy wheels, small roof spoiler, a privately owned car, clean and well kept): a clean side profile, parked in the outdoor marshalling yard of a Malaysian vehicle inspection centre: wet dark tarmac after a tropical shower, painted bay lines, the inspection hall's grey cladding and open roller shutters behind, palm trees and a bright overcast sky. Malaysian number plate reading “DMO 9006” in white characters on a black plate visible at the front and rear edges. Camera at 1.2 m height, perpendicular to the vehicle, 50 mm lens, f/8, soft diffuse daylight. 16:9 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `dmo-9006.interior` · Cabin

- **Shows in:** Vehicle page photo gallery (cabin)
- **Aspect ratio:** 4:3
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/dmo-9006/interior.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Interior photo: right-hand-drive cabin of a 2019 Perodua Myvi: black dashboard with silver accents, 7-inch touchscreen, three-spoke steering wheel, CVT gear lever, black fabric seats, view from the open driver's door. The vehicle is a 2019 Perodua Myvi (third generation) five-door hatchback in silver paint (a sliver of the paint visible on the door frame), parked inside a modern Malaysian vehicle inspection centre with the lane lights visible through the windscreen. If a number plate is in frame it is the Malaysian number plate reading “DMO 9006” in white characters on a black plate. 24 mm lens, f/4, even soft light, slightly lifted shadows, realistic everyday wear. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `dmo-9006.underbody` · Underbody

- **Shows in:** Inspection Management → Undercarriage AI reference and the vehicle page gallery
- **Aspect ratio:** 4:3
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/dmo-9006/underbody.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. View from inside an inspection pit looking up at the underside of a 2019 Perodua Myvi (third generation) five-door hatchback in silver paint (LED headlamps, black grille with a chrome strip, 15-inch alloy wheels, small roof spoiler, a privately owned car, clean and well kept): the front subframe, exhaust, fuel tank and torsion-beam rear axle, clean and dry. Clean concrete pit walls with recessed LED strip lights and a yellow safety edge, the lane floor gratings framing the shot. If a number plate is in frame it is the Malaysian number plate reading “DMO 9006” in white characters on a black plate. 16 mm wide-angle lens, f/5.6, bright even LED light, sharp detail. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `dmo-9006.tyre` · Tyre close-up

- **Shows in:** Inspection Management → Tyre AI reference and the vehicle page gallery
- **Aspect ratio:** 1:1
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/dmo-9006/tyre.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Close-up of the front tyre (185/55 R15) on a 15-inch alloy wheel; an examiner's tread depth gauge rests in a groove. The vehicle is a 2019 Perodua Myvi (third generation) five-door hatchback in silver paint (LED headlamps, black grille with a chrome strip, 15-inch alloy wheels, small roof spoiler, a privately owned car, clean and well kept), standing on the roller brake tester of an inspection lane, grey epoxy floor and yellow lines out of focus behind. If a number plate is in frame it is the Malaysian number plate reading “DMO 9006” in white characters on a black plate. Camera low at wheel-hub height, 70 mm lens, f/4, soft LED light raking across the tread to show its depth. 1:1 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `dmo-9006.engine` · Engine bay

- **Shows in:** Vehicle page photo gallery (engine bay)
- **Aspect ratio:** 4:3
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/dmo-9006/engine.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Engine compartment of a 2019 Perodua Myvi (third generation) five-door hatchback in silver paint (LED headlamps, black grille with a chrome strip, 15-inch alloy wheels, small roof spoiler, a privately owned car, clean and well kept): the engine bay with the bonnet open: the 1.5-litre four-cylinder petrol engine, 12 V battery, coolant and washer reservoirs, inside a modern Malaysian vehicle inspection centre; an LED inspection lamp hanging from the bonnet. Camera above the front bumper looking down at 40 degrees, 28 mm lens, f/8, even light, realistic grime for its age. If a number plate is in frame it is the Malaysian number plate reading “DMO 9006” in white characters on a black plate. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

## VJM 7412 · 2021 Perodua Bezza 1.0 · silver

### `vjm-7412.hero` · Front three-quarter

- **Shows in:** Vehicle Records (list card and vehicle page header), Dashboard lane and queue cards, Inspection Management
- **Aspect ratio:** 4:3
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/vjm-7412/hero.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Front three-quarter view from the front left of a 2021 Perodua Bezza 1.0 G compact sedan (facelift) in silver paint (a rental-fleet car in daily use, 14-inch wheels, otherwise tidy), on an inspection lane, front wheels on the roller brake tester, inside a modern Malaysian vehicle inspection centre: bright high-bay LED strip lighting mixed with soft tropical daylight from tall windows and open roller-shutter doors (palm trees and an overcast sky outside), a light-grey polished epoxy floor with yellow lane lines and black steel floor gratings, slim steel camera gantries with inspection cameras on both sides of the lane. Malaysian number plate reading “VJM 7412” in white characters on a black plate on the front bumper. Camera at 1.3 m height, about 6 m from the vehicle, 35 mm lens, f/5.6, the whole vehicle in frame with a little floor around it. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `vjm-7412.rear` · Rear three-quarter

- **Shows in:** Vehicle page photo gallery
- **Aspect ratio:** 4:3
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/vjm-7412/rear.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Rear three-quarter view of a 2021 Perodua Bezza 1.0 G compact sedan (facelift) in silver paint (a rental-fleet car in daily use, 14-inch wheels, otherwise tidy), showing the rear bumper and boot, with a long thin scratch along the lower right side skirt, parked in the exit bay of the inspection lane inside a modern Malaysian vehicle inspection centre: bright high-bay LED strip lighting mixed with soft tropical daylight from tall windows and open roller-shutter doors (palm trees and an overcast sky outside), a light-grey polished epoxy floor with yellow lane lines and black steel floor gratings, slim steel camera gantries with inspection cameras on both sides of the lane. Malaysian number plate reading “VJM 7412” in white characters on a black plate on the rear. Camera at 1.3 m height, 35 mm lens, f/5.6, whole vehicle in frame. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `vjm-7412.side` · Side profile

- **Shows in:** Vehicle page photo gallery and the inspection report cover
- **Aspect ratio:** 16:9
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/vjm-7412/side.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Side view of a 2021 Perodua Bezza 1.0 G compact sedan (facelift) in silver paint (a rental-fleet car in daily use, 14-inch wheels, otherwise tidy): the right side profile with a long thin scratch along the lower right side skirt and a small shallow dent in the roof, parked in the outdoor marshalling yard of a Malaysian vehicle inspection centre: wet dark tarmac after a tropical shower, painted bay lines, the inspection hall's grey cladding and open roller shutters behind, palm trees and a bright overcast sky. Malaysian number plate reading “VJM 7412” in white characters on a black plate visible at the front and rear edges. Camera at 1.2 m height, perpendicular to the vehicle, 50 mm lens, f/8, soft diffuse daylight. 16:9 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `vjm-7412.interior` · Cabin

- **Shows in:** Vehicle page photo gallery (cabin)
- **Aspect ratio:** 4:3
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/vjm-7412/interior.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Interior photo: right-hand-drive cabin of a 2021 Perodua Bezza: black dashboard, centre stack with three round climate knobs, automatic gear lever, grey fabric seats, view from the open driver's door. The vehicle is a 2021 Perodua Bezza 1.0 G compact sedan (facelift) in silver paint (a sliver of the paint visible on the door frame), parked inside a modern Malaysian vehicle inspection centre with the lane lights visible through the windscreen. If a number plate is in frame it is the Malaysian number plate reading “VJM 7412” in white characters on a black plate. 24 mm lens, f/4, even soft light, slightly lifted shadows, realistic everyday wear. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `vjm-7412.underbody` · Underbody

- **Shows in:** Inspection Management → Undercarriage AI reference and the vehicle page gallery
- **Aspect ratio:** 4:3
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/vjm-7412/underbody.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. View from inside an inspection pit looking up at the underside of a 2021 Perodua Bezza 1.0 G compact sedan (facelift) in silver paint (a rental-fleet car in daily use, 14-inch wheels, otherwise tidy): the front subframe, exhaust, fuel tank and torsion-beam rear axle of a small sedan, dry. Clean concrete pit walls with recessed LED strip lights and a yellow safety edge, the lane floor gratings framing the shot. If a number plate is in frame it is the Malaysian number plate reading “VJM 7412” in white characters on a black plate. 16 mm wide-angle lens, f/5.6, bright even LED light, sharp detail. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `vjm-7412.tyre` · Tyre close-up

- **Shows in:** Inspection Management → Tyre AI reference and the vehicle page gallery
- **Aspect ratio:** 1:1
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/vjm-7412/tyre.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Close-up of the front tyre (175/65 R14); an examiner's tread depth gauge rests in a groove. The vehicle is a 2021 Perodua Bezza 1.0 G compact sedan (facelift) in silver paint (a rental-fleet car in daily use, 14-inch wheels, otherwise tidy), standing on the roller brake tester of an inspection lane, grey epoxy floor and yellow lines out of focus behind. If a number plate is in frame it is the Malaysian number plate reading “VJM 7412” in white characters on a black plate. Camera low at wheel-hub height, 70 mm lens, f/4, soft LED light raking across the tread to show its depth. 1:1 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `vjm-7412.engine` · Engine bay

- **Shows in:** Vehicle page photo gallery (engine bay)
- **Aspect ratio:** 4:3
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/vjm-7412/engine.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Engine compartment of a 2021 Perodua Bezza 1.0 G compact sedan (facelift) in silver paint (a rental-fleet car in daily use, 14-inch wheels, otherwise tidy): the engine bay with the bonnet open: the small 1.0-litre three-cylinder engine; the 12 V battery terminals are crusted with white-green corrosion and the battery case is slightly swollen, inside a modern Malaysian vehicle inspection centre; an LED inspection lamp hanging from the bonnet. Camera above the front bumper looking down at 40 degrees, 28 mm lens, f/8, even light, realistic grime for its age. If a number plate is in frame it is the Malaysian number plate reading “VJM 7412” in white characters on a black plate. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

## WXD 2291 · 2020 Ford Ranger XLT · white

### `wxd-2291.hero` · Front three-quarter

- **Shows in:** Vehicle Records (list card and vehicle page header), Dashboard lane and queue cards, Inspection Management
- **Aspect ratio:** 4:3
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/wxd-2291/hero.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Front three-quarter view from the front left of a 2020 Ford Ranger XLT double-cab pickup (T6, PX facelift) in white paint (chrome grille with three horizontal bars, side steps, sports bar over the tub, 17-inch alloy wheels, a working fleet pickup with light road dust), on an inspection lane, front wheels on the roller brake tester, inside a modern Malaysian vehicle inspection centre: bright high-bay LED strip lighting mixed with soft tropical daylight from tall windows and open roller-shutter doors (palm trees and an overcast sky outside), a light-grey polished epoxy floor with yellow lane lines and black steel floor gratings, slim steel camera gantries with inspection cameras on both sides of the lane. Malaysian number plate reading “WXD 2291” in white characters on a black plate on the front bumper. Camera at 1.3 m height, about 6 m from the vehicle, 35 mm lens, f/5.6, the whole vehicle in frame with a little floor around it. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `wxd-2291.rear` · Rear three-quarter

- **Shows in:** Vehicle page photo gallery
- **Aspect ratio:** 4:3
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/wxd-2291/rear.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Rear three-quarter view of a 2020 Ford Ranger XLT double-cab pickup (T6, PX facelift) in white paint (chrome grille with three horizontal bars, side steps, sports bar over the tub, 17-inch alloy wheels, a working fleet pickup with light road dust), showing the tailgate, sports bar and rear bumper step, parked in the exit bay of the inspection lane inside a modern Malaysian vehicle inspection centre: bright high-bay LED strip lighting mixed with soft tropical daylight from tall windows and open roller-shutter doors (palm trees and an overcast sky outside), a light-grey polished epoxy floor with yellow lane lines and black steel floor gratings, slim steel camera gantries with inspection cameras on both sides of the lane. Malaysian number plate reading “WXD 2291” in white characters on a black plate on the rear. Camera at 1.3 m height, 35 mm lens, f/5.6, whole vehicle in frame. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `wxd-2291.side` · Side profile

- **Shows in:** Vehicle page photo gallery and the inspection report cover
- **Aspect ratio:** 16:9
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/wxd-2291/side.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Side view of a 2020 Ford Ranger XLT double-cab pickup (T6, PX facelift) in white paint (chrome grille with three horizontal bars, side steps, sports bar over the tub, 17-inch alloy wheels, a working fleet pickup with light road dust): a long side profile showing the double cab, side steps and the tub, parked in the outdoor marshalling yard of a Malaysian vehicle inspection centre: wet dark tarmac after a tropical shower, painted bay lines, the inspection hall's grey cladding and open roller shutters behind, palm trees and a bright overcast sky. Malaysian number plate reading “WXD 2291” in white characters on a black plate visible at the front and rear edges. Camera at 1.2 m height, perpendicular to the vehicle, 50 mm lens, f/8, soft diffuse daylight. 16:9 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `wxd-2291.interior` · Cabin

- **Shows in:** Vehicle page photo gallery (cabin)
- **Aspect ratio:** 4:3
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/wxd-2291/interior.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Interior photo: right-hand-drive cabin of a 2020 Ford Ranger XLT: 8-inch touchscreen, dual-zone climate controls, automatic gear lever, black fabric seats, view from the open driver's door. The vehicle is a 2020 Ford Ranger XLT double-cab pickup (T6, PX facelift) in white paint (a sliver of the paint visible on the door frame), parked inside a modern Malaysian vehicle inspection centre with the lane lights visible through the windscreen. If a number plate is in frame it is the Malaysian number plate reading “WXD 2291” in white characters on a black plate. 24 mm lens, f/4, even soft light, slightly lifted shadows, realistic everyday wear. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `wxd-2291.underbody` · Underbody

- **Shows in:** Inspection Management → Undercarriage AI reference and the vehicle page gallery
- **Aspect ratio:** 4:3
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/wxd-2291/underbody.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. View from inside an inspection pit looking up at the underside of a 2020 Ford Ranger XLT double-cab pickup (T6, PX facelift) in white paint (chrome grille with three horizontal bars, side steps, sports bar over the tub, 17-inch alloy wheels, a working fleet pickup with light road dust): the ladder frame, leaf springs, rear differential, transfer case and propeller shaft, with a light oil seep around the transmission. Clean concrete pit walls with recessed LED strip lights and a yellow safety edge, the lane floor gratings framing the shot. If a number plate is in frame it is the Malaysian number plate reading “WXD 2291” in white characters on a black plate. 16 mm wide-angle lens, f/5.6, bright even LED light, sharp detail. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `wxd-2291.tyre` · Tyre close-up

- **Shows in:** Inspection Management → Tyre AI reference and the vehicle page gallery
- **Aspect ratio:** 1:1
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/wxd-2291/tyre.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Close-up of the front-right tyre (265/65 R17) on an alloy wheel: clearly uneven wear on the outer shoulder and a small bulge on the sidewall; an examiner's tread depth gauge rests in a groove. The vehicle is a 2020 Ford Ranger XLT double-cab pickup (T6, PX facelift) in white paint (chrome grille with three horizontal bars, side steps, sports bar over the tub, 17-inch alloy wheels, a working fleet pickup with light road dust), standing on the roller brake tester of an inspection lane, grey epoxy floor and yellow lines out of focus behind. If a number plate is in frame it is the Malaysian number plate reading “WXD 2291” in white characters on a black plate. Camera low at wheel-hub height, 70 mm lens, f/4, soft LED light raking across the tread to show its depth. 1:1 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `wxd-2291.engine` · Engine bay

- **Shows in:** Vehicle page photo gallery (engine bay)
- **Aspect ratio:** 4:3
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/wxd-2291/engine.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Engine compartment of a 2020 Ford Ranger XLT double-cab pickup (T6, PX facelift) in white paint (chrome grille with three horizontal bars, side steps, sports bar over the tub, 17-inch alloy wheels, a working fleet pickup with light road dust): the engine bay with the bonnet open: the 2.2-litre four-cylinder turbo-diesel engine, intercooler pipework and battery, inside a modern Malaysian vehicle inspection centre; an LED inspection lamp hanging from the bonnet. Camera above the front bumper looking down at 40 degrees, 28 mm lens, f/8, even light, realistic grime for its age. If a number plate is in frame it is the Malaysian number plate reading “WXD 2291” in white characters on a black plate. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

## BHY 7783 · 2019 Toyota Hiace 2.8D · white

### `bhy-7783.hero` · Front three-quarter

- **Shows in:** Vehicle Records (list card and vehicle page header), Dashboard lane and queue cards, Inspection Management
- **Aspect ratio:** 4:3
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/bhy-7783/hero.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Front three-quarter view from the front left of a 2019 Toyota HiAce panel van (H200 generation, standard roof, long wheelbase) in white paint (windowless cargo sides, sliding side door, black bumpers, steel wheels with plain hub caps, a working fleet van), on an inspection lane, front wheels on the roller brake tester, inside a modern Malaysian vehicle inspection centre: bright high-bay LED strip lighting mixed with soft tropical daylight from tall windows and open roller-shutter doors (palm trees and an overcast sky outside), a light-grey polished epoxy floor with yellow lane lines and black steel floor gratings, slim steel camera gantries with inspection cameras on both sides of the lane. Malaysian number plate reading “BHY 7783” in white characters on a black plate on the front bumper. Camera at 1.3 m height, about 6 m from the vehicle, 35 mm lens, f/5.6, the whole vehicle in frame with a little floor around it. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `bhy-7783.rear` · Rear three-quarter

- **Shows in:** Vehicle page photo gallery
- **Aspect ratio:** 4:3
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/bhy-7783/rear.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Rear three-quarter view of a 2019 Toyota HiAce panel van (H200 generation, standard roof, long wheelbase) in white paint (windowless cargo sides, sliding side door, black bumpers, steel wheels with plain hub caps, a working fleet van), showing the twin rear doors and black rear bumper, seen from the right: a dent in the right corner of the rear bumper, scrapes along the lower right sliding door and light rust on the right rear wheel arch, parked in the exit bay of the inspection lane inside a modern Malaysian vehicle inspection centre: bright high-bay LED strip lighting mixed with soft tropical daylight from tall windows and open roller-shutter doors (palm trees and an overcast sky outside), a light-grey polished epoxy floor with yellow lane lines and black steel floor gratings, slim steel camera gantries with inspection cameras on both sides of the lane. Malaysian number plate reading “BHY 7783” in white characters on a black plate on the rear. Camera at 1.3 m height, 35 mm lens, f/5.6, whole vehicle in frame. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `bhy-7783.side` · Side profile

- **Shows in:** Vehicle page photo gallery and the inspection report cover
- **Aspect ratio:** 16:9
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/bhy-7783/side.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Side view of a 2019 Toyota HiAce panel van (H200 generation, standard roof, long wheelbase) in white paint (windowless cargo sides, sliding side door, black bumpers, steel wheels with plain hub caps, a working fleet van): the right side profile: scrapes along the lower sliding door and light rust on the right rear wheel arch, parked in the outdoor marshalling yard of a Malaysian vehicle inspection centre: wet dark tarmac after a tropical shower, painted bay lines, the inspection hall's grey cladding and open roller shutters behind, palm trees and a bright overcast sky. Malaysian number plate reading “BHY 7783” in white characters on a black plate visible at the front and rear edges. Camera at 1.2 m height, perpendicular to the vehicle, 50 mm lens, f/8, soft diffuse daylight. 16:9 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `bhy-7783.interior` · Cabin

- **Shows in:** Vehicle page photo gallery (cabin)
- **Aspect ratio:** 4:3
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/bhy-7783/interior.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Interior photo: right-hand-drive cab of a HiAce H200 van: plain grey dashboard, dashboard-mounted gear lever, three-seat front row in dark fabric, view from the open driver's door. The vehicle is a 2019 Toyota HiAce panel van (H200 generation, standard roof, long wheelbase) in white paint (a sliver of the paint visible on the door frame), parked inside a modern Malaysian vehicle inspection centre with the lane lights visible through the windscreen. If a number plate is in frame it is the Malaysian number plate reading “BHY 7783” in white characters on a black plate. 24 mm lens, f/4, even soft light, slightly lifted shadows, realistic everyday wear. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `bhy-7783.underbody` · Underbody

- **Shows in:** Inspection Management → Undercarriage AI reference and the vehicle page gallery
- **Aspect ratio:** 4:3
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/bhy-7783/underbody.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. View from inside an inspection pit looking up at the underside of a 2019 Toyota HiAce panel van (H200 generation, standard roof, long wheelbase) in white paint (windowless cargo sides, sliding side door, black bumpers, steel wheels with plain hub caps, a working fleet van): the van's underside: leaf springs, rear axle, exhaust with soot at the tailpipe and the fuel tank. Clean concrete pit walls with recessed LED strip lights and a yellow safety edge, the lane floor gratings framing the shot. If a number plate is in frame it is the Malaysian number plate reading “BHY 7783” in white characters on a black plate. 16 mm wide-angle lens, f/5.6, bright even LED light, sharp detail. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `bhy-7783.tyre` · Tyre close-up

- **Shows in:** Inspection Management → Tyre AI reference and the vehicle page gallery
- **Aspect ratio:** 1:1
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/bhy-7783/tyre.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Close-up of the front tyre (195/80 R15 commercial tyre) on a steel wheel; an examiner's tread depth gauge rests in a groove. The vehicle is a 2019 Toyota HiAce panel van (H200 generation, standard roof, long wheelbase) in white paint (windowless cargo sides, sliding side door, black bumpers, steel wheels with plain hub caps, a working fleet van), standing on the roller brake tester of an inspection lane, grey epoxy floor and yellow lines out of focus behind. If a number plate is in frame it is the Malaysian number plate reading “BHY 7783” in white characters on a black plate. Camera low at wheel-hub height, 70 mm lens, f/4, soft LED light raking across the tread to show its depth. 1:1 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `bhy-7783.engine` · Engine access

- **Shows in:** Vehicle page photo gallery (engine bay)
- **Aspect ratio:** 4:3
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/bhy-7783/engine.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Engine compartment of a 2019 Toyota HiAce panel van (H200 generation, standard roof, long wheelbase) in white paint (windowless cargo sides, sliding side door, black bumpers, steel wheels with plain hub caps, a working fleet van): engine access with the front passenger seat tilted up: the 2.8-litre diesel engine under the cab floor, inspection lamp lighting it, inside a modern Malaysian vehicle inspection centre; camera at the open front passenger door looking down into the engine bay under the raised seat, 24 mm lens, f/8, even light, realistic grime for its age. If a number plate is in frame it is the Malaysian number plate reading “BHY 7783” in white characters on a black plate. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

## VKR 3128 · 2021 Toyota Vios 1.5 · white

### `vkr-3128.hero` · Front three-quarter

- **Shows in:** Vehicle Records (list card and vehicle page header), Dashboard lane and queue cards, Inspection Management
- **Aspect ratio:** 4:3
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/vkr-3128/hero.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Front three-quarter view from the front left of a 2021 Toyota Vios 1.5 sedan (XP150) in white paint (an e-hailing car in daily use, 15-inch alloy wheels), on an inspection lane, front wheels on the roller brake tester; a small dent in the left front fender, inside a modern Malaysian vehicle inspection centre: bright high-bay LED strip lighting mixed with soft tropical daylight from tall windows and open roller-shutter doors (palm trees and an overcast sky outside), a light-grey polished epoxy floor with yellow lane lines and black steel floor gratings, slim steel camera gantries with inspection cameras on both sides of the lane. Malaysian number plate reading “VKR 3128” in white characters on a black plate on the front bumper. Camera at 1.3 m height, about 6 m from the vehicle, 35 mm lens, f/5.6, the whole vehicle in frame with a little floor around it. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `vkr-3128.rear` · Rear three-quarter

- **Shows in:** Vehicle page photo gallery
- **Aspect ratio:** 4:3
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/vkr-3128/rear.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Rear three-quarter view of a 2021 Toyota Vios 1.5 sedan (XP150) in white paint (an e-hailing car in daily use, 15-inch alloy wheels), showing the rear bumper and boot with light rust starting at the left rear wheel arch, parked in the exit bay of the inspection lane inside a modern Malaysian vehicle inspection centre: bright high-bay LED strip lighting mixed with soft tropical daylight from tall windows and open roller-shutter doors (palm trees and an overcast sky outside), a light-grey polished epoxy floor with yellow lane lines and black steel floor gratings, slim steel camera gantries with inspection cameras on both sides of the lane. Malaysian number plate reading “VKR 3128” in white characters on a black plate on the rear. Camera at 1.3 m height, 35 mm lens, f/5.6, whole vehicle in frame. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `vkr-3128.side` · Side profile

- **Shows in:** Vehicle page photo gallery and the inspection report cover
- **Aspect ratio:** 16:9
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/vkr-3128/side.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Side view of a 2021 Toyota Vios 1.5 sedan (XP150) in white paint (an e-hailing car in daily use, 15-inch alloy wheels): the left side profile: a small dent in the left front fender, a scratch along the left doors and side skirt and light rust at the left rear wheel arch, parked in the outdoor marshalling yard of a Malaysian vehicle inspection centre: wet dark tarmac after a tropical shower, painted bay lines, the inspection hall's grey cladding and open roller shutters behind, palm trees and a bright overcast sky. Malaysian number plate reading “VKR 3128” in white characters on a black plate visible at the front and rear edges. Camera at 1.2 m height, perpendicular to the vehicle, 50 mm lens, f/8, soft diffuse daylight. 16:9 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `vkr-3128.interior` · Cabin

- **Shows in:** Vehicle page photo gallery (cabin)
- **Aspect ratio:** 4:3
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/vkr-3128/interior.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Interior photo: right-hand-drive cabin of a 2021 Toyota Vios: black dashboard, touchscreen, gear lever, fabric seats, a phone holder clipped to an air vent (e-hailing car), view from the open driver's door. The vehicle is a 2021 Toyota Vios 1.5 sedan (XP150) in white paint (a sliver of the paint visible on the door frame), parked inside a modern Malaysian vehicle inspection centre with the lane lights visible through the windscreen. If a number plate is in frame it is the Malaysian number plate reading “VKR 3128” in white characters on a black plate. 24 mm lens, f/4, even soft light, slightly lifted shadows, realistic everyday wear. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `vkr-3128.underbody` · Underbody

- **Shows in:** Inspection Management → Undercarriage AI reference and the vehicle page gallery
- **Aspect ratio:** 4:3
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/vkr-3128/underbody.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. View from inside an inspection pit looking up at the underside of a 2021 Toyota Vios 1.5 sedan (XP150) in white paint (an e-hailing car in daily use, 15-inch alloy wheels): the front subframe, exhaust, fuel tank and torsion-beam rear axle, dry. Clean concrete pit walls with recessed LED strip lights and a yellow safety edge, the lane floor gratings framing the shot. If a number plate is in frame it is the Malaysian number plate reading “VKR 3128” in white characters on a black plate. 16 mm wide-angle lens, f/5.6, bright even LED light, sharp detail. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `vkr-3128.tyre` · Tyre close-up

- **Shows in:** Inspection Management → Tyre AI reference and the vehicle page gallery
- **Aspect ratio:** 1:1
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/vkr-3128/tyre.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Close-up of the front-left wheel and tyre (185/60 R15); through the alloy spokes the brake disc shows concentric scoring. The vehicle is a 2021 Toyota Vios 1.5 sedan (XP150) in white paint (an e-hailing car in daily use, 15-inch alloy wheels), standing on the roller brake tester of an inspection lane, grey epoxy floor and yellow lines out of focus behind. If a number plate is in frame it is the Malaysian number plate reading “VKR 3128” in white characters on a black plate. Camera low at wheel-hub height, 70 mm lens, f/4, soft LED light raking across the tread to show its depth. 1:1 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `vkr-3128.engine` · Engine bay

- **Shows in:** Vehicle page photo gallery (engine bay)
- **Aspect ratio:** 4:3
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/vkr-3128/engine.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Engine compartment of a 2021 Toyota Vios 1.5 sedan (XP150) in white paint (an e-hailing car in daily use, 15-inch alloy wheels): the engine bay with the bonnet open: the 1.5-litre four-cylinder petrol engine, 12 V battery and reservoirs, inside a modern Malaysian vehicle inspection centre; an LED inspection lamp hanging from the bonnet. Camera above the front bumper looking down at 40 degrees, 28 mm lens, f/8, even light, realistic grime for its age. If a number plate is in frame it is the Malaysian number plate reading “VKR 3128” in white characters on a black plate. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

## PKE 4410 · 2021 Toyota Innova 2.0 · white

### `pke-4410.hero` · Front three-quarter

- **Shows in:** Vehicle Records (list card and vehicle page header), Dashboard lane and queue cards, Inspection Management
- **Aspect ratio:** 4:3
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/pke-4410/hero.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Front three-quarter view from the front left of a 2021 Toyota Innova 2.0 seven-seat MPV (AN140, facelift) in white paint (large trapezoid grille with chrome bars, 16-inch alloy wheels, a fleet MPV in daily use), on an inspection lane, front wheels on the roller brake tester, inside a modern Malaysian vehicle inspection centre: bright high-bay LED strip lighting mixed with soft tropical daylight from tall windows and open roller-shutter doors (palm trees and an overcast sky outside), a light-grey polished epoxy floor with yellow lane lines and black steel floor gratings, slim steel camera gantries with inspection cameras on both sides of the lane. Malaysian number plate reading “PKE 4410” in white characters on a black plate on the front bumper. Camera at 1.3 m height, about 6 m from the vehicle, 35 mm lens, f/5.6, the whole vehicle in frame with a little floor around it. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `pke-4410.rear` · Rear three-quarter

- **Shows in:** Vehicle page photo gallery
- **Aspect ratio:** 4:3
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/pke-4410/rear.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Rear three-quarter view of a 2021 Toyota Innova 2.0 seven-seat MPV (AN140, facelift) in white paint (large trapezoid grille with chrome bars, 16-inch alloy wheels, a fleet MPV in daily use), showing the tailgate and rear bumper, parked in the exit bay of the inspection lane inside a modern Malaysian vehicle inspection centre: bright high-bay LED strip lighting mixed with soft tropical daylight from tall windows and open roller-shutter doors (palm trees and an overcast sky outside), a light-grey polished epoxy floor with yellow lane lines and black steel floor gratings, slim steel camera gantries with inspection cameras on both sides of the lane. Malaysian number plate reading “PKE 4410” in white characters on a black plate on the rear. Camera at 1.3 m height, 35 mm lens, f/5.6, whole vehicle in frame. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `pke-4410.side` · Side profile

- **Shows in:** Vehicle page photo gallery and the inspection report cover
- **Aspect ratio:** 16:9
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/pke-4410/side.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Side view of a 2021 Toyota Innova 2.0 seven-seat MPV (AN140, facelift) in white paint (large trapezoid grille with chrome bars, 16-inch alloy wheels, a fleet MPV in daily use): the right side profile with a long scratch along the lower right doors and side skirt, parked in the outdoor marshalling yard of a Malaysian vehicle inspection centre: wet dark tarmac after a tropical shower, painted bay lines, the inspection hall's grey cladding and open roller shutters behind, palm trees and a bright overcast sky. Malaysian number plate reading “PKE 4410” in white characters on a black plate visible at the front and rear edges. Camera at 1.2 m height, perpendicular to the vehicle, 50 mm lens, f/8, soft diffuse daylight. 16:9 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `pke-4410.interior` · Cabin and ADAS camera

- **Shows in:** Vehicle page photo gallery (cabin)
- **Aspect ratio:** 4:3
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/pke-4410/interior.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Interior photo: the cabin seen from the second row looking forward, right-hand drive: dashboard with touchscreen, and a forward-facing ADAS camera module on the windscreen behind the rear-view mirror, its mount slightly tilted. The vehicle is a 2021 Toyota Innova 2.0 seven-seat MPV (AN140, facelift) in white paint (a sliver of the paint visible on the door frame), parked inside a modern Malaysian vehicle inspection centre with the lane lights visible through the windscreen. If a number plate is in frame it is the Malaysian number plate reading “PKE 4410” in white characters on a black plate. 24 mm lens, f/4, even soft light, slightly lifted shadows, realistic everyday wear. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `pke-4410.underbody` · Underbody

- **Shows in:** Inspection Management → Undercarriage AI reference and the vehicle page gallery
- **Aspect ratio:** 4:3
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/pke-4410/underbody.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. View from inside an inspection pit looking up at the underside of a 2021 Toyota Innova 2.0 seven-seat MPV (AN140, facelift) in white paint (large trapezoid grille with chrome bars, 16-inch alloy wheels, a fleet MPV in daily use): the body-on-frame underside: ladder frame rails, four-link coil-spring rear axle, propeller shaft, exhaust and fuel tank, dry. Clean concrete pit walls with recessed LED strip lights and a yellow safety edge, the lane floor gratings framing the shot. If a number plate is in frame it is the Malaysian number plate reading “PKE 4410” in white characters on a black plate. 16 mm wide-angle lens, f/5.6, bright even LED light, sharp detail. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `pke-4410.tyre` · Tyre close-up

- **Shows in:** Inspection Management → Tyre AI reference and the vehicle page gallery
- **Aspect ratio:** 1:1
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/pke-4410/tyre.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Close-up of the front tyre (205/65 R16) on a 16-inch alloy wheel; an examiner's tread depth gauge rests in a groove. The vehicle is a 2021 Toyota Innova 2.0 seven-seat MPV (AN140, facelift) in white paint (large trapezoid grille with chrome bars, 16-inch alloy wheels, a fleet MPV in daily use), standing on the roller brake tester of an inspection lane, grey epoxy floor and yellow lines out of focus behind. If a number plate is in frame it is the Malaysian number plate reading “PKE 4410” in white characters on a black plate. Camera low at wheel-hub height, 70 mm lens, f/4, soft LED light raking across the tread to show its depth. 1:1 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `pke-4410.engine` · Engine bay

- **Shows in:** Vehicle page photo gallery (engine bay)
- **Aspect ratio:** 4:3
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/pke-4410/engine.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Engine compartment of a 2021 Toyota Innova 2.0 seven-seat MPV (AN140, facelift) in white paint (large trapezoid grille with chrome bars, 16-inch alloy wheels, a fleet MPV in daily use): the engine bay with the bonnet open: the 2.0-litre four-cylinder petrol engine, battery and reservoirs, inside a modern Malaysian vehicle inspection centre; an LED inspection lamp hanging from the bonnet. Camera above the front bumper looking down at 40 degrees, 28 mm lens, f/8, even light, realistic grime for its age. If a number plate is in frame it is the Malaysian number plate reading “PKE 4410” in white characters on a black plate. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

## JTR 5510 · 2020 Nissan NV350 Urvan · white

### `jtr-5510.hero` · Front three-quarter

- **Shows in:** Vehicle Records (list card and vehicle page header), Dashboard lane and queue cards, Inspection Management
- **Aspect ratio:** 4:3
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/jtr-5510/hero.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Front three-quarter view from the front left of a 2020 Nissan NV350 Urvan panel van (E26 generation, standard roof) in white paint (windowless cargo sides, black bumpers, steel wheels with plain hub caps, a working fleet van), on an inspection lane, front wheels on the roller brake tester, inside a modern Malaysian vehicle inspection centre: bright high-bay LED strip lighting mixed with soft tropical daylight from tall windows and open roller-shutter doors (palm trees and an overcast sky outside), a light-grey polished epoxy floor with yellow lane lines and black steel floor gratings, slim steel camera gantries with inspection cameras on both sides of the lane. Malaysian number plate reading “JTR 5510” in white characters on a black plate on the front bumper. Camera at 1.3 m height, about 6 m from the vehicle, 35 mm lens, f/5.6, the whole vehicle in frame with a little floor around it. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `jtr-5510.rear` · Rear three-quarter

- **Shows in:** Vehicle page photo gallery
- **Aspect ratio:** 4:3
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/jtr-5510/rear.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Rear three-quarter view of a 2020 Nissan NV350 Urvan panel van (E26 generation, standard roof) in white paint (windowless cargo sides, black bumpers, steel wheels with plain hub caps, a working fleet van), showing the rear doors seen from the right: the right tail lamp lens is cracked and the right rear door sits slightly proud with an uneven panel gap, parked in the exit bay of the inspection lane inside a modern Malaysian vehicle inspection centre: bright high-bay LED strip lighting mixed with soft tropical daylight from tall windows and open roller-shutter doors (palm trees and an overcast sky outside), a light-grey polished epoxy floor with yellow lane lines and black steel floor gratings, slim steel camera gantries with inspection cameras on both sides of the lane. Malaysian number plate reading “JTR 5510” in white characters on a black plate on the rear. Camera at 1.3 m height, 35 mm lens, f/5.6, whole vehicle in frame. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `jtr-5510.side` · Side profile

- **Shows in:** Vehicle page photo gallery and the inspection report cover
- **Aspect ratio:** 16:9
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/jtr-5510/side.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Side view of a 2020 Nissan NV350 Urvan panel van (E26 generation, standard roof) in white paint (windowless cargo sides, black bumpers, steel wheels with plain hub caps, a working fleet van): a long side profile, parked in the outdoor marshalling yard of a Malaysian vehicle inspection centre: wet dark tarmac after a tropical shower, painted bay lines, the inspection hall's grey cladding and open roller shutters behind, palm trees and a bright overcast sky. Malaysian number plate reading “JTR 5510” in white characters on a black plate visible at the front and rear edges. Camera at 1.2 m height, perpendicular to the vehicle, 50 mm lens, f/8, soft diffuse daylight. 16:9 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `jtr-5510.interior` · Cabin

- **Shows in:** Vehicle page photo gallery (cabin)
- **Aspect ratio:** 4:3
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/jtr-5510/interior.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Interior photo: right-hand-drive cab of an NV350 Urvan: grey dashboard, dashboard-mounted gear lever, three-seat front row, view from the open driver's door. The vehicle is a 2020 Nissan NV350 Urvan panel van (E26 generation, standard roof) in white paint (a sliver of the paint visible on the door frame), parked inside a modern Malaysian vehicle inspection centre with the lane lights visible through the windscreen. If a number plate is in frame it is the Malaysian number plate reading “JTR 5510” in white characters on a black plate. 24 mm lens, f/4, even soft light, slightly lifted shadows, realistic everyday wear. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `jtr-5510.underbody` · Underbody

- **Shows in:** Inspection Management → Undercarriage AI reference and the vehicle page gallery
- **Aspect ratio:** 4:3
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/jtr-5510/underbody.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. View from inside an inspection pit looking up at the underside of a 2020 Nissan NV350 Urvan panel van (E26 generation, standard roof) in white paint (windowless cargo sides, black bumpers, steel wheels with plain hub caps, a working fleet van): the rear suspension seen from the pit: leaf springs and a rear shock absorber wet with oil and caked with dust. Clean concrete pit walls with recessed LED strip lights and a yellow safety edge, the lane floor gratings framing the shot. If a number plate is in frame it is the Malaysian number plate reading “JTR 5510” in white characters on a black plate. 16 mm wide-angle lens, f/5.6, bright even LED light, sharp detail. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `jtr-5510.tyre` · Tyre close-up

- **Shows in:** Inspection Management → Tyre AI reference and the vehicle page gallery
- **Aspect ratio:** 1:1
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/jtr-5510/tyre.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Close-up of the front tyre (195/80 R15 commercial tyre) on a steel wheel; an examiner's tread depth gauge rests in a groove. The vehicle is a 2020 Nissan NV350 Urvan panel van (E26 generation, standard roof) in white paint (windowless cargo sides, black bumpers, steel wheels with plain hub caps, a working fleet van), standing on the roller brake tester of an inspection lane, grey epoxy floor and yellow lines out of focus behind. If a number plate is in frame it is the Malaysian number plate reading “JTR 5510” in white characters on a black plate. Camera low at wheel-hub height, 70 mm lens, f/4, soft LED light raking across the tread to show its depth. 1:1 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `jtr-5510.engine` · Engine access

- **Shows in:** Vehicle page photo gallery (engine bay)
- **Aspect ratio:** 4:3
- **Stock photo:** no (prompt only)
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/jtr-5510/engine.jpg`

```text
Photorealistic documentary photo in the style of an automated inspection-system capture: neutral cool white balance, crisp detail, natural reflections on the paint, true-to-life colours, no motion blur, no lens flare. Engine compartment of a 2020 Nissan NV350 Urvan panel van (E26 generation, standard roof) in white paint (windowless cargo sides, black bumpers, steel wheels with plain hub caps, a working fleet van): engine access with the front seat tilted up: the 2.5-litre diesel engine under the cab floor, inspection lamp lighting it, inside a modern Malaysian vehicle inspection centre; camera at the open front passenger door looking down into the engine bay under the raised seat, 24 mm lens, f/8, even light, realistic grime for its age. If a number plate is in frame it is the Malaysian number plate reading “JTR 5510” in white characters on a black plate. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

## Scenes

### `scene.hub` · Inspection centre exterior

- **Shows in:** Dashboard header and the Oversight → HQ hub cards
- **Aspect ratio:** 16:9
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/scenes/hub.jpg`

```text
Exterior of a modern Malaysian vehicle inspection centre at mid-morning: a long single-storey steel-and-glass hall with a deep canopy over four drive-through inspection lanes, roller-shutter doors open to show bright lanes inside, lane numbers 1 to 4 above the doors and nothing else written anywhere, a white sedan, a silver hatchback and a white panel van queueing in marked bays, a white prime mover in the separate heavy-vehicle bay, tropical landscaping with palm trees, wet tarmac after a shower, bright sky with cumulus clouds. Any visible number plates are Malaysian style, white characters on black, starting “DMO”. Eye-level camera from across the forecourt, 24 mm lens, f/8, soft daylight, photorealistic architectural photo. 16:9 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `scene.lane` · Inspection lane and roller brake tester

- **Shows in:** Live Lane header
- **Aspect ratio:** 16:9
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/scenes/lane.jpg`

```text
Inside a modern Malaysian vehicle inspection lane: a white Toyota Vios sedan with its front wheels on a roller brake tester set into a light-grey polished epoxy floor, yellow lane lines, black steel floor gratings, slim steel camera gantries with inspection cameras on both sides, a wall-mounted brake test display panel showing only abstract bars, high-bay LED strip lighting and soft tropical daylight from open roller-shutter doors with palm trees outside. Malaysian number plate “VKR 3128” in white characters on a black plate. Camera at 1.4 m height looking down the lane, 28 mm lens, f/5.6, crisp documentary style matching an automated inspection-system capture. 16:9 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `scene.pit` · Inspection pit

- **Shows in:** Inspection Management → Undercarriage AI header
- **Aspect ratio:** 4:3
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/scenes/pit.jpg`

```text
A vehicle inspection pit in a Malaysian inspection centre: a long concrete pit with recessed LED strip lights in its walls and a yellow-and-black safety edge, a white panel van parked over it with its underside lit, a ceiling of steel beams and high-bay lights above, tidy and clean. Camera at the pit's end looking along it, 20 mm lens, f/5.6, bright even light, photorealistic. 4:3 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `scene.flood` · Flooded road in Malaysia

- **Shows in:** Oversight → Flood watch header
- **Aspect ratio:** 16:9
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/scenes/flood.jpg`

```text
A flooded residential road in Selangor, Malaysia, the morning after monsoon rain: brown floodwater up to the wheel arches of several parked cars (a silver Perodua Myvi, a white Toyota Vios, a white van), terrace houses and a row of shophouses behind, rain trees, an overcast grey sky, reflections on the water, a few residents wading at a distance (no recognisable faces). Malaysian-style number plates, white on black, not legible. Eye-level camera, 35 mm lens, f/8, soft overcast light, photojournalistic and calm. 16:9 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `scene.tyre` · Tyre tread close-up

- **Shows in:** Inspection Management → Tyre AI
- **Aspect ratio:** 1:1
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/scenes/tyre.jpg`

```text
Close-up of a car tyre tread on an inspection lane: worn but legal tread with clear grooves and wear indicators, a stainless tread depth gauge pressed into one groove, a little road grit, the grey epoxy floor and a yellow line out of focus. Camera low at tread height, 90 mm macro lens, f/5.6, raking LED light to show depth, photorealistic product-style detail. 1:1 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```

### `scene.login` · Login background

- **Shows in:** Login page background
- **Aspect ratio:** 21:9
- **Stock photo:** yes
- **Add it:** upload it in Settings → Images, or save it as `app/backend/var/images/scenes/login.jpg`

```text
Wide atmospheric dusk view of a Malaysian expressway curving towards the Kuala Lumpur skyline: long-exposure light trails of traffic, a deep-blue sky with the last warm glow on the horizon, light haze, city lights and tropical trees along the road, calm and premium. Composition with open, darker space on the left third for a login card. Elevated camera position, 24 mm lens, f/8, 20-second exposure, photorealistic, subtle cool colour grade. 21:9 aspect ratio. No people in frame unless stated; no text overlays, no logos, no watermarks, no brand names on signage.
```
