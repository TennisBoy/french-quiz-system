export type Role = "student" | "teacher";
export type Mark = "correct" | "incorrect" | "review";
export type SubmissionStatus = "submitted" | "graded" | "returned";

export interface Profile {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: Role;
  class_id: string | null;
  must_change_password: boolean;
}

export interface ClassRow {
  id: string;
  code: string;
  name: string | null;
}

export interface Question {
  id: string;
  type: "choice" | "text";
  prompt: string;
  context?: string;
  options?: string[];
  points?: number;
}

export interface Section {
  id: string;
  title: string;
  instructions?: string;
  questions: Question[];
}

export interface Assignment {
  id: string;
  title: string;
  description: string | null;
  content: { sections: Section[] };
  is_open: boolean;
  due_at: string | null;
  show_score_on_submit: boolean;
}

export interface KeyEntry {
  correct?: number;
  accept?: string[];
  explanation?: string;
}
export type AnswerKey = Record<string, KeyEntry>;

/** Choice questions store the original option index; text questions store the text. */
export type Answers = Record<string, number | string>;

/** Returned by the my_submission_detail() RPC. Feedback fields are null until the work is returned. */
export interface MySubmissionDetail {
  status: SubmissionStatus;
  submitted_at: string;
  returned_at: string | null;
  answers: Answers;
  score: number | null;
  max_score: number | null;
  marks: Record<string, Mark> | null;
  question_comments: Record<string, string> | null;
  teacher_comment: string | null;
  key: AnswerKey | null;
}

export interface Submission {
  id: string;
  assignment_id: string;
  student_id: string;
  answers: Answers;
  auto_results: Record<string, Mark>;
  teacher_marks: Record<string, Mark>;
  question_comments: Record<string, string>;
  teacher_comment: string | null;
  score: number;
  max_score: number;
  status: SubmissionStatus;
  submitted_at: string;
  graded_at: string | null;
  returned_at: string | null;
}
