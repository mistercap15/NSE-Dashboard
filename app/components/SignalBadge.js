"use client";
import { getSignalLabel, getSignalClass } from "../lib/api";

export default function SignalBadge({ winRate, signal }) {
  const label = signal || getSignalLabel(winRate);
  const cls   = getSignalClass(label);
  return <span className={`badge ${cls}`}>{label}</span>;
}
