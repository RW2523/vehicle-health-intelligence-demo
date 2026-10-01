"use client";
/* Vehicle photos in the mobile app: the image library's photos of a vehicle (components/Photo.tsx), with the vehicle's
   illustration wherever there is no photo. */
import { Photo, VehiclePhoto, useVehiclePhotos } from "./Photo";

export type { Photo };

/** The vehicle's photos: the hero shot and the gallery (empty while loading or when there are none). */
export function useMobilePhotos(plate: string | null | undefined) {
  const r = useVehiclePhotos(plate);
  return { hero: r.data?.hero || null, gallery: r.data?.gallery || [], paint: r.data?.paint_hex || null, loaded: !!r.data || !!r.error };
}

/** One photo of a vehicle (with its credit button when asked), or its illustration. */
export function MobileVehiclePhoto({ plate, vtype, photo, className = "", size = "960", alt, credit = false }: {
  plate: string; vtype?: string; photo?: Photo | null; className?: string; size?: "480" | "960" | "1600"; alt?: string; credit?: boolean;
}) {
  return <VehiclePhoto plate={plate} vtype={vtype} photo={photo} className={className} size={size} alt={alt} credit={credit} />;
}
