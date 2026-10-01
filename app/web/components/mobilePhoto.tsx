"use client";
/* Vehicle photos in the mobile app: the image library's photos of a vehicle (components/Photo.tsx), with the vehicle's
   illustration wherever there is no photo. */
import { Photo, VehiclePhoto, useVehiclePhotos } from "./Photo";

/** The ten main vehicles (vhi/services/showcase.py on the API): the only ones with stock photos in the image library. */
const MAIN_PLATES = new Set(["DMO 9001", "DMO 9002", "DMO 9003", "DMO 9006", "VJM 7412", "WXD 2291", "BHY 7783", "VKR 3128", "PKE 4410", "JTR 5510"]);

export type { Photo };

/** The vehicle's photos: the hero shot and the gallery (empty while loading or when there are none). */
export function useMobilePhotos(plate: string | null | undefined) {
  const r = useVehiclePhotos(plate);
  return { hero: r.data?.hero || null, gallery: r.data?.gallery || [], paint: r.data?.paint_hex || null, loaded: !!r.data || !!r.error };
}

/** The credit button (ⓘ) is drawn small on the photo; this widens what a finger can hit to 40 px around it. */
const CREDIT_HIT = "[&_button[aria-expanded]]:relative [&_button[aria-expanded]]:after:absolute [&_button[aria-expanded]]:after:-inset-2 [&_button[aria-expanded]]:after:rounded-full [&_button[aria-expanded]]:after:content-['']";

/** One photo of a vehicle (with its credit button when asked), or its illustration. */
export function MobileVehiclePhoto({ plate, vtype, photo, className = "", size = "960", alt, credit = false }: {
  plate: string; vtype?: string; photo?: Photo | null; className?: string; size?: "480" | "960" | "1600"; alt?: string; credit?: boolean;
}) {
  return <VehiclePhoto plate={plate} vtype={vtype} photo={photo} className={`${className} ${credit ? CREDIT_HIT : ""}`} size={size} alt={alt} credit={credit} />;
}

/** A small picture of a vehicle in a list: a main vehicle's stock photo (its listing photo may be a lane camera's
 *  close-up of the plate), else the listing's own photo, else the vehicle's illustration on a soft backdrop (never an
 *  empty grey tile). */
export function MobileVehicleThumb({ plate, vtype, src, className = "" }: { plate: string; vtype?: string; src?: string | null; className?: string }) {
  const main = MAIN_PLATES.has(plate);
  const stock = useMobilePhotos(main ? plate : null);
  if (stock.hero) return <VehiclePhoto plate={plate} vtype={vtype} photo={stock.hero} size="480" className={className} alt="" />;
  if (src && (!main || stock.loaded))
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" loading="lazy" decoding="async" className={`object-cover ${className}`} />;
  return (
    <span className={`flex items-center justify-center bg-gradient-to-br from-[#DBEAFE] via-[#EEF4FF] to-[#E0F2FE] px-2 ${className}`}>
      <VehiclePhoto plate={plate} vtype={vtype} className="h-full max-h-[110px] w-full" />
    </span>
  );
}
