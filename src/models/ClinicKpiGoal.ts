import mongoose, { Document, Schema } from 'mongoose';

export interface IClinicKpiGoal extends Document {
  clinic_id:     string;
  preset_key:    string;
  preset_name:   string;
  target_value:  number;
  direction:     'higher_better' | 'lower_better';
  is_active:     boolean;
  display_order: number;
  phase:         number;
  unit:          string;
  createdAt:     Date;
  updatedAt:     Date;
}

const ClinicKpiGoalSchema = new Schema<IClinicKpiGoal>(
  {
    clinic_id:     { type: String, required: true, index: true },
    preset_key:    { type: String, required: true },
    preset_name:   { type: String, required: true },
    target_value:  { type: Number, required: true },
    direction:     { type: String, enum: ['higher_better', 'lower_better'], required: true },
    is_active:     { type: Boolean, default: true },
    display_order: { type: Number, default: 0 },
    phase:         { type: Number, default: 1 },
    unit:          { type: String, default: '%' },
  },
  { timestamps: true }
);

// One goal record per clinic per preset
ClinicKpiGoalSchema.index({ clinic_id: 1, preset_key: 1 }, { unique: true });

export const ClinicKpiGoal = mongoose.model<IClinicKpiGoal>('ClinicKpiGoal', ClinicKpiGoalSchema);