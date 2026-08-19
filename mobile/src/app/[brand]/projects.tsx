import { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { useBrand } from "@/context/BrandContext";
import { Button } from "@/components/Button";
import { Card, ScreenHeader, SectionLabel } from "@/components/ui";
import { listClientProjects, removeClientProject, saveClientProject, type ClientProject, type ReviewStatus } from "@/lib/clientProjects";
import { SPACE, RADIUS } from "@/lib/theme";
import { getLibrary, type LibraryDesign } from "@/lib/designLibrary";

const STATUS: { id: ReviewStatus; label: string }[] = [
  { id: "draft", label: "Draft" }, { id: "sent", label: "In review" },
  { id: "changes", label: "Changes" }, { id: "approved", label: "Approved" },
];

export default function ProjectsScreen() {
  const { brand, theme } = useBrand();
  const [projects, setProjects] = useState<ClientProject[]>([]);
  const [designs, setDesigns] = useState<LibraryDesign[]>([]);
  const [editing, setEditing] = useState<ClientProject | null>(null);
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [placement, setPlacement] = useState("");
  const [notes, setNotes] = useState("");
  const [designIds, setDesignIds] = useState<string[]>([]);
  const refresh = useCallback(() => Promise.all([listClientProjects(brand.id), getLibrary(brand.id)]).then(([nextProjects, nextDesigns]) => { setProjects(nextProjects); setDesigns(nextDesigns); }), [brand.id]);
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  function begin(project?: ClientProject) {
    setEditing(project ?? ({ id: "", status: "draft" } as ClientProject));
    setName(project?.name ?? ""); setClient(project?.client ?? "");
    setPlacement(project?.placement ?? ""); setNotes(project?.notes ?? "");
    setDesignIds(project?.designIds ?? []);
  }
  async function save() {
    if (!name.trim()) return Alert.alert("Project name needed", "Give this client project a clear name first.");
    await saveClientProject(brand.id, { ...(editing?.id ? editing : {}), name, client, placement, notes, designIds });
    setEditing(null); await refresh(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }
  async function changeStatus(project: ClientProject, status: ReviewStatus) {
    await saveClientProject(brand.id, { ...project, name: project.name, status }); await refresh();
  }

  return <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.scroll}>
    <ScreenHeader eyebrow="Client workspace" title="Projects & approvals" subtitle="Keep every concept, placement note, revision, and client decision together." />
    <Button label="New client project" icon="add" variant="primary" onPress={() => begin()} />
    {editing && <Card style={{ marginTop: SPACE.md }}>
      <Field label="PROJECT" value={name} onChange={setName} placeholder="Botanical half sleeve" />
      <Field label="CLIENT" value={client} onChange={setClient} placeholder="Client name" />
      <Field label="PLACEMENT" value={placement} onChange={setPlacement} placeholder="Outer forearm · 7 in" />
      <Field label="NOTES" value={notes} onChange={setNotes} placeholder="Creative direction, revision notes, appointment details…" multiline />
      {!!designs.length && <><Text style={{ color: theme.muted, fontFamily: theme.fontBodyMedium, fontSize: 9, letterSpacing: 1.2, marginBottom: 5 }}>PROJECT ARTWORK</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.designRow}>{designs.map(design => { const selected = designIds.includes(design.id); return <Pressable key={design.id} onPress={() => setDesignIds(ids => selected ? ids.filter(id => id !== design.id) : [...ids, design.id])} style={[styles.design, { borderColor: selected ? theme.accent : theme.line, backgroundColor: theme.stock }]}><Image source={{ uri: design.uri }} style={styles.designImage} contentFit="contain" /><View style={[styles.designCheck, { backgroundColor: selected ? theme.accent : theme.surface }]}><Ionicons name={selected ? "checkmark" : "add"} size={12} color={selected ? theme.accentText : theme.muted} /></View></Pressable>; })}</ScrollView></>}
      <View style={styles.actions}><Button label="Cancel" icon="close" onPress={() => setEditing(null)} style={{ flex: 1 }} /><Button label="Save project" icon="checkmark" variant="primary" onPress={save} style={{ flex: 1 }} /></View>
    </Card>}
    <View style={{ marginTop: SPACE.xl }}><SectionLabel>{projects.length ? "Active work" : "Project workspace"}</SectionLabel></View>
    <View style={{ gap: SPACE.sm }}>{projects.length ? projects.map(project => <Pressable key={project.id} onPress={() => begin(project)} onLongPress={() => Alert.alert("Delete project?", project.name, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: async () => { await removeClientProject(brand.id, project.id); refresh(); } }])} style={[styles.project, { backgroundColor: theme.surface, borderColor: theme.line }]}>
      <View style={[styles.projectIcon, { backgroundColor: `${theme.accent}18` }]}><Ionicons name="folder-open-outline" size={21} color={theme.accent} /></View>
      <View style={{ flex: 1 }}><Text style={{ color: theme.foreground, fontFamily: theme.fontBodyMedium, fontSize: 15 }}>{project.name}</Text><Text numberOfLines={1} style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 11 }}>{[project.client, project.placement].filter(Boolean).join(" · ") || "Add client and placement details"}</Text><Text style={{ color: theme.muted, fontFamily: theme.fontBody, fontSize: 9, marginTop: 3 }}>{project.designIds.length} attached design{project.designIds.length === 1 ? "" : "s"}</Text><View style={styles.statusRow}>{STATUS.map(item => <Pressable key={item.id} onPress={() => changeStatus(project, item.id)} style={[styles.status, { borderColor: project.status === item.id ? theme.accent : theme.line, backgroundColor: project.status === item.id ? `${theme.accent}18` : theme.surfaceAlt }]}><Text style={{ color: project.status === item.id ? theme.accent : theme.muted, fontSize: 9, fontFamily: theme.fontBodyMedium }}>{item.label.toUpperCase()}</Text></Pressable>)}</View></View>
      <Ionicons name="chevron-forward" size={17} color={theme.muted} />
    </Pressable>) : <Card><Text style={{ color: theme.muted, fontFamily: theme.fontBody, lineHeight: 20 }}>Create a project for each client. Approval state and revision notes stay private on this device until explicitly shared.</Text></Card>}</View>
  </ScrollView>;
}

function Field({ label, value, onChange, placeholder, multiline = false }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; multiline?: boolean }) {
  const { theme } = useBrand();
  return <View style={{ marginBottom: SPACE.sm }}><Text style={{ color: theme.muted, fontFamily: theme.fontBodyMedium, fontSize: 9, letterSpacing: 1.2, marginBottom: 5 }}>{label}</Text><TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={theme.muted} multiline={multiline} style={[styles.input, multiline && { minHeight: 78, textAlignVertical: "top" }, { color: theme.foreground, backgroundColor: theme.surfaceAlt, borderColor: theme.line, fontFamily: theme.fontBody }]} /></View>;
}

const styles = StyleSheet.create({ scroll: { padding: SPACE.md, paddingTop: SPACE.lg, paddingBottom: SPACE.xxl }, input: { minHeight: 46, borderWidth: 1, borderRadius: RADIUS.sm, paddingHorizontal: 12, paddingVertical: 10 }, actions: { flexDirection: "row", gap: SPACE.sm, marginTop: SPACE.xs }, project: { borderWidth: 1, borderRadius: RADIUS.md, padding: 12, flexDirection: "row", gap: SPACE.sm, alignItems: "flex-start" }, projectIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" }, statusRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 9 }, status: { borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: 7, paddingVertical: 4 }, designRow: { gap: 7, paddingBottom: SPACE.sm }, design: { width: 74, height: 74, borderWidth: 2, borderRadius: RADIUS.sm, overflow: "hidden" }, designImage: { width: "100%", height: "100%" }, designCheck: { position: "absolute", right: 4, top: 4, width: 19, height: 19, borderRadius: 10, alignItems: "center", justifyContent: "center" } });
