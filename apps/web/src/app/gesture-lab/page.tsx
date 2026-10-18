"use client";
import dynamic from "next/dynamic";
const GestureLab = dynamic(() => import("../../components/gesture-lab/GestureLab"), { ssr: false });
export default function Page() { return <GestureLab />; }
