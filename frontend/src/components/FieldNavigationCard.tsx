import { Link } from "react-router-dom";

import type { FieldDescriptor } from "../services/fields";

export function FieldNavigationCard({ field }: { field: FieldDescriptor }) {
  return (
    <Link className="field-card" to={field.route}>
      <span className="field-card__title">{field.name}</span>
      <span className="field-card__description">
        {field.description ?? "No description is available."}
      </span>
    </Link>
  );
}
