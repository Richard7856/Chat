import * as React from "react";
import { cn } from "../../lib/cn";

/**
 * Avatar con iniciales y fondo de gradiente determinístico desde el username.
 * Mismo username → mismo color siempre. Sin fotos: cero upload/storage.
 */

function colorFromUsername(username: string): { from: string; to: string } {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = (hash << 5) - hash + username.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  const sat = 62 + (Math.abs(hash) % 15);
  return {
    from: `hsl(${hue} ${sat}% 55%)`,
    to: `hsl(${(hue + 25) % 360} ${sat}% 45%)`,
  };
}

function initialsOf(displayName: string | undefined | null, username: string): string {
  const src = (displayName ?? "").trim() || username;
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export type AvatarSize = "xs" | "sm" | "md" | "lg";

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  username: string;
  displayName?: string | null;
  size?: AvatarSize;
}

const sizeClasses: Record<AvatarSize, string> = {
  xs: "size-6 text-[10px]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-12 text-base",
};

export function Avatar({
  username,
  displayName,
  size = "md",
  className,
  style,
  ...props
}: AvatarProps) {
  const { from, to } = colorFromUsername(username);
  const initials = initialsOf(displayName, username);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-1 ring-black/10 select-none",
        sizeClasses[size],
        className,
      )}
      style={{
        backgroundImage: `linear-gradient(135deg, ${from}, ${to})`,
        ...style,
      }}
      aria-hidden
      {...props}
    >
      {initials}
    </span>
  );
}
