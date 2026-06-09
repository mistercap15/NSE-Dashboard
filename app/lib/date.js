const NSE_TIME_ZONE = "Asia/Kolkata";

function getNseDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NSE_TIME_ZONE,
    year: "numeric",
    month: "numeric",
  }).formatToParts(date);

  return {
    month: Number(parts.find((part) => part.type === "month")?.value),
    year: Number(parts.find((part) => part.type === "year")?.value),
  };
}

export function getCurrentMonth() {
  return getNseDateParts().month;
}

export function getCurrentYear() {
  return getNseDateParts().year;
}

export function getNextMonth(month = getCurrentMonth()) {
  return month === 12 ? 1 : month + 1;
}
