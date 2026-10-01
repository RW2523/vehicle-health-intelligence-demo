"use client";
/* A vehicle's photo where the image library has one (stock or uploaded), else its illustration: VehiclePhoto from
   components/Photo.tsx, taking the `photo` objects the API puts on vehicles, lanes and inspections. */
import { Photo, VehiclePhoto } from "./Photo";

export type PhotoLike = Photo | null | undefined;

export function VehicleImage({ plate, vtype, photo, className = "", size = "960", credit = false, alt }: {
  plate: string; vtype?: string; photo?: PhotoLike; className?: string; size?: "480" | "960" | "full"; credit?: boolean; alt?: string;
}) {
  return <VehiclePhoto plate={plate} vtype={vtype} photo={photo || null} className={className} size={size === "full" ? "1600" : size} credit={credit} alt={alt} />;
}
