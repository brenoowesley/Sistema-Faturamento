"use client";

import dynamic from "next/dynamic";

const ComoUsar = dynamic(() => import("@/components/como-usar/ComoUsar"), { ssr: false });

export default function ComoUsarPage() {
    return (
        <div style={{ padding: "0 8px" }}>
            <ComoUsar />
        </div>
    );
}
