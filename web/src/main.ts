import { homeFor, navigate, startRouter } from "./router";
import { renderLogin, renderChangePassword } from "./pages/auth";
import { renderStudentHome, renderStudentAssignment } from "./pages/student";
import { renderTeacherDashboard } from "./pages/teacherDashboard";
import { renderTeacherReview } from "./pages/teacherReview";
import { renderTeacherStudents } from "./pages/teacherStudents";

startRouter(document.getElementById("app")!, [
  { path: "/", public: true, render: (_main, _params, profile) => navigate(profile ? homeFor(profile) : "/login", true) },
  { path: "/login", render: renderLogin, public: true },
  { path: "/mot-de-passe", render: renderChangePassword },
  { path: "/eleve", render: renderStudentHome, role: "student" },
  { path: "/eleve/devoir/:id", render: renderStudentAssignment, role: "student" },
  { path: "/enseignant", render: renderTeacherDashboard, role: "teacher" },
  { path: "/enseignant/remise/:id", render: renderTeacherReview, role: "teacher" },
  { path: "/enseignant/eleves", render: renderTeacherStudents, role: "teacher" },
]);
