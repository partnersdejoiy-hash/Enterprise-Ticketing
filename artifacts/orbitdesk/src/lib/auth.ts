import { create } from "zustand";
import type { User } from "@workspace/api-client-react";

interface AuthState {
  token: string | null;
  user: User | null;
  setAuth: (token: string, user: User) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem("auth_token"),
  user: localStorage.getItem("auth_user") 
    ? JSON.parse(localStorage.getItem("auth_user") as string) 
    : null,
  setAuth: (token, user) => {
    localStorage.setItem("auth_token", token);
    localStorage.setItem("auth_user", JSON.stringify(user));
    set({ token, user });
  },
  logout: () => {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_user");
    set({ token: null, user: null });
  },
}));
