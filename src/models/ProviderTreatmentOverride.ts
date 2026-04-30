import mongoose, { Document, Schema } from 'mongoose';

export interface IProviderTreatmentOverride extends Document {
  locationId:            string;
  provider_name:         string;
  treatment_name:        string;
  override_procedure_min: number | null;
  override_buffer_min:   number | null;
  createdAt:             Date;
  updatedAt:             Date;
}

const ProviderTreatmentOverrideSchema = new Schema<IProviderTreatmentOverride>({
  locationId:             { type: String, required: true, index: true },
  provider_name:          { type: String, required: true },
  treatment_name:         { type: String, required: true },
  override_procedure_min: { type: Number, default: null },
  override_buffer_min:    { type: Number, default: null },
}, { timestamps: true });

// Compound index — one override per provider+treatment per location
ProviderTreatmentOverrideSchema.index(
  { locationId: 1, provider_name: 1, treatment_name: 1 },
  { unique: true }
);

export const ProviderTreatmentOverride = mongoose.model<IProviderTreatmentOverride>(
  'ProviderTreatmentOverride',
  ProviderTreatmentOverrideSchema
);