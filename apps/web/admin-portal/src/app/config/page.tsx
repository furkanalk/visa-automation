"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ConfigPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/settings?tab=config");
  }, [router]);
  return null;
}
