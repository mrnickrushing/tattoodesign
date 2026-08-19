import AsyncStorage from "@react-native-async-storage/async-storage";
import type { BrandId } from "./brands";
import { generateId } from "./id";

export type ReviewStatus = "draft" | "sent" | "changes" | "approved";

export type ClientProject = {
  id: string;
  name: string;
  client: string;
  placement: string;
  notes: string;
  designIds: string[];
  status: ReviewStatus;
  approvalNote?: string;
  /** Local-noon timestamp of the appointment, from appointments.ts parsing. */
  appointmentAt?: number;
  /** Agreed physical size in inches. */
  sizeIn?: { width: number; height: number };
  /** file:// URIs of reference photos attached to this project. */
  referenceUris?: string[];
  createdAt: number;
  updatedAt: number;
};

const key = (brand: BrandId) => `inkline:client-projects:${brand}`;

export async function listClientProjects(brand: BrandId): Promise<ClientProject[]> {
  try {
    return JSON.parse((await AsyncStorage.getItem(key(brand))) ?? "[]") as ClientProject[];
  } catch {
    return [];
  }
}

export async function saveClientProject(brand: BrandId, input: Partial<ClientProject> & Pick<ClientProject, "name">) {
  const projects = await listClientProjects(brand);
  const now = Date.now();
  const existing = input.id ? projects.find((project) => project.id === input.id) : undefined;
  const next: ClientProject = {
    id: existing?.id ?? generateId(),
    name: input.name.trim() || "Untitled project",
    client: input.client?.trim() ?? existing?.client ?? "",
    placement: input.placement?.trim() ?? existing?.placement ?? "",
    notes: input.notes?.trim() ?? existing?.notes ?? "",
    designIds: input.designIds ?? existing?.designIds ?? [],
    status: input.status ?? existing?.status ?? "draft",
    approvalNote: input.approvalNote ?? existing?.approvalNote,
    appointmentAt: "appointmentAt" in input ? input.appointmentAt : existing?.appointmentAt,
    sizeIn: "sizeIn" in input ? input.sizeIn : existing?.sizeIn,
    referenceUris: input.referenceUris ?? existing?.referenceUris,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await AsyncStorage.setItem(key(brand), JSON.stringify([next, ...projects.filter((project) => project.id !== next.id)]));
  return next;
}

export async function removeClientProject(brand: BrandId, id: string) {
  await AsyncStorage.setItem(key(brand), JSON.stringify((await listClientProjects(brand)).filter((project) => project.id !== id)));
}

