import { cookies } from "next/headers";

export async function setHttpOnlyCookie(name: string, value: string, maxAgeSec: number) {
  const store = await cookies();
  store.set({
    name,
    value,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSec,
  });
}

export async function getCookie(name: string) {
  const store = await cookies();
  return store.get(name)?.value ?? null;
}

export async function clearCookie(name: string) {
  const store = await cookies();
  store.set({
    name,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
