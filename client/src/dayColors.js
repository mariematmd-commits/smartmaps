// Distinct colors for each planned day, shared by the day cards and the map.
export const DAY_COLORS = [
  '#2563eb', // blue
  '#16a34a', // green
  '#db2777', // pink
  '#d97706', // amber
  '#7c3aed', // violet
  '#0891b2', // cyan
  '#dc2626', // red
];

export const dayColor = (i) => DAY_COLORS[i % DAY_COLORS.length];
