import mongoose, { Document, Schema } from 'mongoose';

export interface ITreatment extends Document {
  locationId:          string;
  name:                string;
  category:            string;
  price:               number;
  duration_minutes:    number;
  required_equipment:  string[];
  prime_hour_eligible: boolean;
  revenue_per_hour:    number;
  room_type:           string;
  provider_qualification: string;
  isActive:            boolean;
  createdAt:           Date;
  updatedAt:           Date;
}

const TreatmentSchema = new Schema<ITreatment>({
  locationId:             { type: String, required: true, index: true },
  name:                   { type: String, required: true },
  category:               { type: String, required: true, default: 'mid_ticket' },
  price:                  { type: Number, required: true, default: 0 },
  duration_minutes:       { type: Number, required: true, default: 60 },
  required_equipment:     { type: [String], default: [] },
  prime_hour_eligible:    { type: Boolean, default: true },
  revenue_per_hour:       { type: Number, default: 0 },
  room_type:              { type: String, default: '' },
  provider_qualification: { type: String, default: '' },
  isActive:               { type: Boolean, default: true },
}, { timestamps: true });

export const Treatment = mongoose.model<ITreatment>('Treatment', TreatmentSchema);