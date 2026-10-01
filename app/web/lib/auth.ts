"use client";
/* The logged-in account (vhi/auth.py on the API): who it is, where its role starts and which apps it opens. */
import { useEffect, useState } from "react";
import { api } from "./api";

export type User = {
  username: string;
  name: string;
  role: string;
  title: string;
  branch_id?: string | null;
  examiner_id?: string | null;
  senior?: boolean;
  plate?: string | null;
};

/** Where each role starts after logging in: its app (lib/apps.ts) and the section it uses most. */
export const ROLE_HOME: Record<string, string> = {
  presenter: "/", viewer: "/", examiner: "/", hq: "/oversight/hq", regulator: "/oversight/regulator", fleet: "/vehicles", owner: "/mobile",
};

/** The presenter and the read-only viewer open every app; other roles open the apps that list them. */
export const canOpen = (role: string | undefined, roles: string[]) =>
  role === "presenter" || role === "viewer" || roles.includes("*") || roles.includes(role || "");

let cached: Promise<User | null> | null = null;

export function loadUser(fresh = false): Promise<User | null> {
  if (!cached || fresh) cached = api.get("/api/auth/me").catch(() => null);
  return cached;
}

/** The logged-in account: undefined while it loads, null when nobody is logged in. */
export function useUser() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    loadUser().then((u) => alive && setUser(u));
    return () => {
      alive = false;
    };
  }, []);
  return user;
}

export async function logout() {
  await api.post("/api/auth/logout").catch(() => {});
  cached = null;
  location.assign("/login");
}
