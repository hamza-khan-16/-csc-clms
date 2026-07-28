import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { Guarded } from "@/components/Guard";
import { SectionCard } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "My Profile — CSC Leave Management" },
      {
        name: "description",
        content: "Your staff profile, role, department and current leave entitlement.",
      },
      { property: "og:title", content: "My Profile — CSC Leave Management" },
      { property: "og:description", content: "Staff profile and leave entitlement." },
    ],
  }),
  component: () => (
    <Guarded>
      <ProfilePage />
    </Guarded>
  ),
});

function ProfilePage() {
  const { profile, role, session } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState(profile?.full_name ?? "");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 3) return toast.error("Enter your full name");
    setBusy(true);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: name.trim() })
      .eq("id", profile!.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Profile updated");
    qc.invalidateQueries();
  }

  return (
    <AppShell title="My Profile" subtitle="Account details and entitlement">
      <div className="grid gap-6 lg:grid-cols-2 max-w-xl">
        <SectionCard title="Details">
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Full name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={session?.user.email ?? ""} disabled />
            </div>
            <div className="space-y-2">
              <Label>College ID</Label>
              <Input value={profile?.user_id ?? ""} disabled />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Role</Label>
                <Input value={role ?? ""} disabled className="capitalize" />
              </div>
              <div className="space-y-2">
                <Label>Designation</Label>
                <Input value={profile?.designation ?? ""} disabled className="capitalize" />
              </div>
            </div>
            <Button type="submit" disabled={busy}>
              Save changes
            </Button>
          </form>
        </SectionCard>


      </div>
    </AppShell>
  );
}
