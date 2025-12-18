import { cookies } from "next/headers";

export function setHttpOnlyCookie(name: string, value: string, maxAgeSec: number) {
  cookies().set({
    name,
    value,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSec,
  });
}

export function getCookie(name: string) {
  return cookies().get(name)?.value ?? null;
}

export function clearCookie(name: string) {
  cookies().set({
    name,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
