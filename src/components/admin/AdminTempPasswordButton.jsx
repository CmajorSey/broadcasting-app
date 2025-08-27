// @ts-nocheck
import { useState } from "react";
import API_BASE from "@/api";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export default function AdminTempPasswordButton({ userId, userName }) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const generateTemp = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/admin/users/${userId}/temp-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || "Failed to create temp password");

      await navigator.clipboard.writeText(data.tempPassword);
      toast({
        title: "Temporary password created",
        description: `Copied to clipboard for ${userName}: ${data.tempPassword}`,
      });
    } catch (err) {
      toast({ title: "Error", description: err.message || "Failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button size="sm" variant="outline" onClick={generateTemp} disabled={loading}>
      {loading ? "Generating…" : "Generate Temp Password"}
    </Button>
  );
}
