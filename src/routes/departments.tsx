import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, X, Check } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard, Empty } from "@/components/ui-bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/departments")({
  head: () => ({
    meta: [
      { title: "Departments — CSC Leave Management" },
      {
        name: "description",
        content: "College departments, their courses and FY/SY/TY classes with staff counts.",
      },
      { property: "og:title", content: "Departments — CSC Leave Management" },
      { property: "og:description", content: "Departments, courses and classes overview." },
    ],
  }),
  component: () => (
    <Guarded roles={["principal", "admin"]}>
      <DepartmentsPage />
    </Guarded>
  ),
});

type Department = {
  id: string;
  name: string;
  courses: string;
  classes: string;
  staff: number;
};

/** Parse comma-separated course string into a trimmed array, filtering empties */
function parseCourses(raw: string): string[] {
  return raw
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

/** Serialise course array back to the DB text format */
function serialiseCourses(arr: string[]): string {
  return arr.join(", ");
}

function CourseManager({ dept, isAdmin }: { dept: Department; isAdmin: boolean }) {
  const qc = useQueryClient();
  const [newCourse, setNewCourse] = useState("");
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editVal, setEditVal] = useState("");
  const [busy, setBusy] = useState(false);

  const courses = parseCourses(dept.courses);

  async function saveCourses(updated: string[]) {
    setBusy(true);
    const { error } = await supabase
      .from("departments")
      .update({ courses: serialiseCourses(updated) })
      .eq("id", dept.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return false;
    }
    qc.invalidateQueries({ queryKey: ["departments-overview"] });
    return true;
  }

  async function addCourse() {
    const trimmed = newCourse.trim();
    if (!trimmed) return;
    if (courses.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      toast.error("Course already exists in this department");
      return;
    }
    const ok = await saveCourses([...courses, trimmed]);
    if (ok) setNewCourse("");
  }

  async function deleteCourse(idx: number) {
    const updated = courses.filter((_, i) => i !== idx);
    await saveCourses(updated);
  }

  async function confirmEdit(idx: number) {
    const trimmed = editVal.trim();
    if (!trimmed) return;
    if (
      courses.some((c, i) => i !== idx && c.toLowerCase() === trimmed.toLowerCase())
    ) {
      toast.error("Another course with that name already exists");
      return;
    }
    const updated = courses.map((c, i) => (i === idx ? trimmed : c));
    const ok = await saveCourses(updated);
    if (ok) setEditIdx(null);
  }

  if (!isAdmin) {
    // Read-only view
    return (
      <p className="mt-1 text-sm">{courses.length > 0 ? courses.join(", ") : "—"}</p>
    );
  }

  return (
    <div className="space-y-2">
      {/* Existing courses */}
      {courses.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No courses added yet.</p>
      ) : (
        <ul className="space-y-1">
          {courses.map((course, idx) => (
            <li key={idx} className="flex items-center gap-2">
              {editIdx === idx ? (
                <>
                  <Input
                    className="h-7 flex-1 text-sm"
                    value={editVal}
                    autoFocus
                    onChange={(e) => setEditVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") confirmEdit(idx);
                      if (e.key === "Escape") setEditIdx(null);
                    }}
                  />
                  <button
                    className="text-success hover:opacity-70 disabled:opacity-40"
                    disabled={busy}
                    onClick={() => confirmEdit(idx)}
                    title="Save"
                  >
                    <Check size={15} />
                  </button>
                  <button
                    className="text-muted-foreground hover:opacity-70"
                    onClick={() => setEditIdx(null)}
                    title="Cancel"
                  >
                    <X size={15} />
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm">{course}</span>
                  <button
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => { setEditIdx(idx); setEditVal(course); }}
                    title="Rename"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    className="text-muted-foreground hover:text-destructive disabled:opacity-40"
                    disabled={busy}
                    onClick={() => deleteCourse(idx)}
                    title="Remove"
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Add new course */}
      <div className="flex gap-2 pt-1">
        <Input
          className="h-8 flex-1 text-sm"
          placeholder="New course name…"
          value={newCourse}
          onChange={(e) => setNewCourse(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCourse(); } }}
          disabled={busy}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-8 px-2"
          onClick={addCourse}
          disabled={busy || !newCourse.trim()}
        >
          <Plus size={14} className="mr-1" /> Add
        </Button>
      </div>
    </div>
  );
}

function DepartmentsPage() {
  const { role } = useAuth();
  const isAdmin = role === "admin";

  const { data: rows = [] } = useQuery({
    queryKey: ["departments-overview"],
    queryFn: async () => {
      const { data, error } = await supabase.from("departments").select("*").order("name");
      if (error) throw error;
      const { data: staff } = await supabase.from("profiles").select("id, department_id");
      return (data ?? []).map((d) => ({
        ...d,
        staff: (staff ?? []).filter((s) => s.department_id === d.id).length,
      })) as Department[];
    },
  });

  return (
    <AppShell
      title="Departments"
      subtitle={
        isAdmin
          ? "Manage courses for each department"
          : "Courses and classes across the college"
      }
    >
      {rows.length === 0 ? (
        <SectionCard>
          <Empty>No departments configured.</Empty>
        </SectionCard>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((d) => (
            <SectionCard key={d.id} title={d.name} subtitle={`${d.staff} staff member(s)`}>
              <div className="space-y-4 text-sm">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                    Courses {isAdmin && <span className="normal-case font-normal text-muted-foreground/70">(click ✎ to edit)</span>}
                  </p>
                  <CourseManager dept={d} isAdmin={isAdmin} />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Classes
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {(d.classes || "FY,SY,TY").split(",").map((c) => (
                      <Badge key={c} variant="secondary">
                        {c.trim()}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </SectionCard>
          ))}
        </div>
      )}
    </AppShell>
  );
}
