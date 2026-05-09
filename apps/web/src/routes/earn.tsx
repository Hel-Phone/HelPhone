import { createFileRoute } from "@tanstack/react-router"
import { EarnPage } from "../features/earn/components/EarnPage"

export const Route = createFileRoute("/earn")({ component: EarnPage })
