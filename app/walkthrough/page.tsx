import type { Metadata } from "next";
import { GamepadWalkthrough } from "@/components/gamepad-walkthrough";

export const metadata: Metadata = {
  title: "Walkthrough",
  description: "See how a prompt becomes a playable game and a live Pons market.",
};

export default function WalkthroughPage() {
  return <GamepadWalkthrough />;
}
