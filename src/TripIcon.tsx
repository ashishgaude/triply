import { useState } from "react";
import {
  Building2,
  Car,
  Mountain,
  Palmtree,
  Plane,
  Ship,
  Tent,
  TrainFront,
} from "lucide-react";
import { normalizeTripIcon, tripIconIds } from "./ledger";
import type { TripIconId } from "./ledger";
import "./TripIcon.css";

const icons = {
  plane: { label: "Flight", component: Plane },
  car: { label: "Road trip", component: Car },
  train: { label: "Train", component: TrainFront },
  beach: { label: "Beach", component: Palmtree },
  mountain: { label: "Mountains", component: Mountain },
  camping: { label: "Camping", component: Tent },
  city: { label: "City", component: Building2 },
  boat: { label: "Boat", component: Ship },
};

export default function TripIcon({
  icon,
  size = 18,
}: {
  icon?: string;
  size?: number;
}) {
  const { component: Icon, label } = icons[normalizeTripIcon(icon)];
  return (
    <span className="trip-icon" title={label}>
      <Icon size={size} aria-hidden="true" />
    </span>
  );
}

export function TripIconPicker({
  defaultValue,
  disabled = false,
}: {
  defaultValue?: TripIconId;
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState(() =>
    normalizeTripIcon(defaultValue),
  );
  return (
    <fieldset className="trip-icon-picker" disabled={disabled}>
      <legend>Trip icon</legend>
      <div className="trip-icon-options">
        {tripIconIds.map((id) => {
          const { component: Icon, label } = icons[id];
          return (
            <label
              key={id}
              className={selected === id ? "chosen" : ""}
              title={label}
            >
              <input
                type="radio"
                name="icon"
                value={id}
                checked={selected === id}
                onChange={() => setSelected(id)}
                aria-label={label}
              />
              <Icon size={21} aria-hidden="true" />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
