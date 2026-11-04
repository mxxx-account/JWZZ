/// <reference types="vite/client" />
interface AssessmentInput { age:number; gender:1|2; HbA1c:number; diabetes_duration:number; systolic_bp:number; diastolic_bp:number; total_cholesterol:number; triglycerides:number; HDL:number; glucose:number; uric_acid:number }
interface AssessmentResult { model_version:string; risk_probability:number; screening_threshold:number; screening_flag:boolean; screening_message:string; recommendation:string; disclaimer:string; top_factors:Array<{feature:string; direction:'增加模型风险'|'降低模型风险'; contribution:number}> }
interface Window { assessment: { predict: (input: AssessmentInput) => Promise<AssessmentResult> } }

