import mongoose, { Document, Schema } from 'mongoose';

export interface IAlert extends Document {
  locationId:         string;
  alert_type:         string;
  severity:           'critical' | 'warning' | 'info';
  title:              string;
  description:        string;
  affected_resource:  string;
  recommended_action: string;
  date:               string;
  revenue_impact:     number;
  is_resolved:        boolean;
  resolved_at?:       Date | null;
  triggered_by:       string;
  metadata:           Record<string, any>;
  createdAt:          Date;
  updatedAt:          Date;
}

const AlertSchema = new Schema<IAlert>(
  {
    locationId:         { type: String, required: true, index: true },
    alert_type:         { type: String, required: true },
    severity:           { type: String, enum: ['critical', 'warning', 'info'], required: true },
    title:              { type: String, required: true },
    description:        { type: String, default: '' },
    affected_resource:  { type: String, default: '' },
    recommended_action: { type: String, default: '' },
    date:               { type: String, default: () => new Date().toISOString().split('T')[0] },
    revenue_impact:     { type: Number, default: 0 },
    is_resolved:        { type: Boolean, default: false, index: true },
    resolved_at:        { type: Date, default: null },
    triggered_by:       { type: String, default: 'manual' },
    metadata:           { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const Alert = mongoose.model<IAlert>('Alert', AlertSchema);