import { useCallback, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { useBrand } from "@/context/BrandContext";
import { Button } from "@/components/Button";
import { Card, ScreenHeader, SectionLabel } from "@/components/ui";
import { CropMarks } from "@/components/StockPane";
import { EmptyStock } from "@/components/EmptyStock";
import { Icon } from "@/components/Icon";
import { PaperSubstrate } from "@/components/PaperSubstrate";
import {
  listClientProjects,
  removeClientProject,
  saveClientProject,
  type ClientProject,
  type ReviewStatus,
} from "@/lib/clientProjects";
import { getLibrary, setDesignTags, type LibraryDesign } from "@/lib/designLibrary";
import { htmlToPdf } from "@/lib/printing";
import { normalizeTags } from "@/lib/libraryFilter";
import {
  describeAppointment,
  formatAppointmentDate,
  parseAppointmentDate,
  parseSizeIn,
  sortByAppointment,
} from "@/lib/appointments";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import { proofHtml, type ProofDesign } from "@/lib/proofSheet";
import { shareUri } from "@/lib/files";
import { RADIUS, SPACE, TYPE } from "@/lib/theme";
import { CONTENT_MAX_WIDTH, useContentBottomInset } from "@/lib/chrome";

const STATUS: { id: ReviewStatus; label: string }[] = [
  { id: "draft", label: "Draft" },
  { id: "sent", label: "In review" },
  { id: "changes", label: "Changes" },
  { id: "approved", label: "Approved" },
];

export default function ProjectsScreen() {
  const { brand, theme } = useBrand();
  const bottomInset = useContentBottomInset();
  const [projects, setProjects] = useState<ClientProject[]>([]);
  const [designs, setDesigns] = useState<LibraryDesign[]>([]);
  const [editing, setEditing] = useState<ClientProject | null>(null);
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [placement, setPlacement] = useState("");
  const [notes, setNotes] = useState("");
  const [designIds, setDesignIds] = useState<string[]>([]);
  const [appointment, setAppointment] = useState("");
  const [size, setSize] = useState("");
  const [referenceUris, setReferenceUris] = useState<string[]>([]);

  const refresh = useCallback(
    () =>
      Promise.all([listClientProjects(brand.id), getLibrary(brand.id)]).then(
        ([nextProjects, nextDesigns]) => {
          setProjects(nextProjects);
          setDesigns(nextDesigns);
        },
      ),
    [brand.id],
  );

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  function begin(project?: ClientProject) {
    setEditing(project ?? ({ id: "", status: "draft" } as ClientProject));
    setName(project?.name ?? "");
    setClient(project?.client ?? "");
    setPlacement(project?.placement ?? "");
    setNotes(project?.notes ?? "");
    setDesignIds(project?.designIds ?? []);
    setAppointment(project?.appointmentAt ? formatAppointmentDate(project.appointmentAt) : "");
    setSize(project?.sizeIn ? `${project.sizeIn.width} x ${project.sizeIn.height}` : "");
    setReferenceUris(project?.referenceUris ?? []);
  }

  async function save() {
    if (!name.trim()) {
      Alert.alert(
        "Project name needed",
        "Give this client project a clear name first.",
      );
      return;
    }
    const appointmentAt = appointment.trim() ? parseAppointmentDate(appointment) : undefined;
    if (appointment.trim() && appointmentAt === null) {
      Alert.alert("Couldn't read that date", 'Try "2026-09-04", "9/4", or "Sep 4".');
      return;
    }
    const sizeIn = size.trim() ? parseSizeIn(size) : undefined;
    if (size.trim() && sizeIn === null) {
      Alert.alert("Couldn't read that size", 'Try "3 x 5" — width by height, in inches.');
      return;
    }
    await saveClientProject(brand.id, {
      ...(editing?.id ? editing : {}),
      name,
      client,
      placement,
      notes,
      designIds,
      appointmentAt: appointmentAt ?? undefined,
      sizeIn: sizeIn ?? undefined,
      referenceUris,
    });
    setEditing(null);
    await refresh();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Wave A tags make "everything for this client" one tap. Offer, don't force.
    const clientTag = normalizeTags(client)[0];
    if (clientTag && designIds.length) {
      const untagged = designs.filter(
        (design) => designIds.includes(design.id) && !(design.tags ?? []).includes(clientTag)
      );
      if (untagged.length) {
        Alert.alert(
          `Tag ${untagged.length} design${untagged.length === 1 ? "" : "s"} "${clientTag}"?`,
          "Tagged designs show up under the client's chip in the library.",
          [
            { text: "Not now", style: "cancel" },
            {
              text: "Tag them",
              onPress: async () => {
                for (const design of untagged) {
                  await setDesignTags(brand.id, design.id, [...(design.tags ?? []), clientTag]);
                }
                await refresh();
              },
            },
          ]
        );
      }
    }
  }

  async function addReference() {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (picked.canceled || !picked.assets.length) return;
    setReferenceUris((uris) => [...uris, ...picked.assets.map((asset) => asset.uri)]);
  }

  async function changeStatus(project: ClientProject, status: ReviewStatus) {
    await saveClientProject(brand.id, {
      ...project,
      name: project.name,
      status,
    });
    await refresh();
  }

  function toggleDesign(design: LibraryDesign) {
    const selected = designIds.includes(design.id);
    setDesignIds((ids) =>
      selected ? ids.filter((id) => id !== design.id) : [...ids, design.id],
    );
  }

  const [proofing, setProofing] = useState<string | null>(null);

  async function sendProof(project: ClientProject) {
    setProofing(project.id);
    try {
      const attached = designs.filter((design) => project.designIds.includes(design.id));
      const proofDesigns: ProofDesign[] = [];
      for (const design of attached) {
        try {
          const data = await new File(design.uri).base64();
          proofDesigns.push({
            title: design.title,
            dataUrl: `data:image/png;base64,${data}`,
            width: design.width ?? 1,
            height: design.height ?? 1,
          });
        } catch {
          // A missing file shouldn't sink the whole proof; the sheet reads
          // fine with the designs that loaded.
        }
      }
      await shareUri(await htmlToPdf(proofHtml(project, proofDesigns, brand.name)));
      if (project.status === "draft") {
        Alert.alert("Mark as sent?", "Move this project to In review now the proof is out?", [
          { text: "Keep as draft", style: "cancel" },
          { text: "Mark sent", onPress: () => void changeStatus(project, "sent") },
        ]);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert("Couldn't build the proof", e instanceof Error ? e.message : "Try again.");
    } finally {
      setProofing(null);
    }
  }

  function confirmDelete(project: ClientProject) {
    Alert.alert("Delete project?", project.name, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await removeClientProject(brand.id, project.id);
          await refresh();
        },
      },
    ]);
  }

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset, maxWidth: CONTENT_MAX_WIDTH, width: "100%", alignSelf: "center" }]}
    >
      <ScreenHeader
        eyebrow="Client workspace"
        title="Projects & approvals"
        subtitle="Keep every concept, placement note, revision, and client decision together."
      />
      <Button
        label="New client project"
        icon="add"
        variant="primary"
        onPress={() => begin()}
      />

      {editing && (
        <Card style={styles.editor}>
          <Field
            label="PROJECT"
            value={name}
            onChange={setName}
            placeholder="Botanical half sleeve"
          />
          <Field
            label="CLIENT"
            value={client}
            onChange={setClient}
            placeholder="Client name"
          />
          <Field
            label="PLACEMENT"
            value={placement}
            onChange={setPlacement}
            placeholder="Outer forearm · 7 in"
          />
          <Field
            label="APPOINTMENT"
            value={appointment}
            onChange={setAppointment}
            placeholder='Sep 4, or "9/4"'
          />
          <Field
            label="SIZE (IN)"
            value={size}
            onChange={setSize}
            placeholder="3 x 5"
          />
          <Field
            label="NOTES"
            value={notes}
            onChange={setNotes}
            placeholder="Creative direction, revision notes, appointment details…"
            multiline
          />

          <Text
            style={[
              styles.fieldLabel,
              { color: theme.muted, fontFamily: theme.fontBodyMedium },
            ]}
          >
            REFERENCE PHOTOS
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.designRow}
          >
            {referenceUris.map((uri) => (
              <Pressable
                key={uri}
                onLongPress={() =>
                  setReferenceUris((uris) => uris.filter((item) => item !== uri))
                }
                accessibilityRole="imagebutton"
                accessibilityLabel="Reference photo"
                accessibilityHint="Long press to remove"
                style={[styles.design, { backgroundColor: theme.stock, borderColor: theme.line }]}
              >
                <Image source={{ uri }} style={styles.designImage} contentFit="cover" />
              </Pressable>
            ))}
            <Pressable
              onPress={addReference}
              accessibilityRole="button"
              accessibilityLabel="Add reference photo"
              style={[styles.design, styles.addReference, { borderColor: theme.line }]}
            >
              <Icon name="add" size={22} color={theme.muted} />
            </Pressable>
          </ScrollView>

          {!!designs.length && (
            <>
              <Text
                style={[
                  styles.fieldLabel,
                  { color: theme.muted, fontFamily: theme.fontBodyMedium },
                ]}
              >
                PROJECT ARTWORK
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.designRow}
              >
                {designs.map((design, index) => {
                  const selected = designIds.includes(design.id);
                  return (
                    <Pressable
                      key={design.id}
                      onPress={() => toggleDesign(design)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                      accessibilityLabel={`Attach ${design.title}`}
                      style={[
                        styles.design,
                        {
                          backgroundColor: theme.stock,
                          borderColor: selected ? theme.accent : theme.line,
                        },
                      ]}
                    >
                      <PaperSubstrate seed={index + 240} />
                      <CropMarks color={theme.stockMark} />
                      <Image
                        source={{ uri: design.uri }}
                        style={styles.designImage}
                        contentFit="contain"
                      />
                      <View
                        style={[
                          styles.designCheck,
                          {
                            backgroundColor: selected
                              ? theme.accent
                              : `${theme.stock}e8`,
                          },
                        ]}
                      >
                        <Icon
                          name={selected ? "checkmark" : "add"}
                          size={TYPE.caption.fontSize}
                          color={selected ? theme.accentText : theme.stockInk}
                        />
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </>
          )}

          <View style={styles.actions}>
            <Button
              label="Cancel"
              icon="close"
              onPress={() => setEditing(null)}
              style={styles.flex}
            />
            <Button
              label="Save project"
              icon="checkmark"
              variant="primary"
              onPress={save}
              style={styles.flex}
            />
          </View>
        </Card>
      )}

      <View style={styles.listHeader}>
        <SectionLabel>
          {projects.length ? "Active work" : "Project workspace"}
        </SectionLabel>
      </View>
      <View style={styles.projectList}>
        {projects.length ? (
          sortByAppointment(projects).map((project) => (
            <Pressable
              key={project.id}
              onPress={() => begin(project)}
              onLongPress={() => confirmDelete(project)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${project.name}`}
              accessibilityHint="Long press to delete this project"
              style={[
                styles.project,
                { backgroundColor: theme.surface, borderColor: theme.line },
              ]}
            >
              <View
                style={[
                  styles.projectIcon,
                  { backgroundColor: `${theme.accent}18` },
                ]}
              >
                <Icon
                  name="projects"
                  size={SPACE.lg - SPACE.xs}
                  color={theme.accent}
                />
              </View>
              <View style={styles.flex}>
                <Text
                  style={[
                    styles.projectName,
                    {
                      color: theme.foreground,
                      fontFamily: theme.fontBodyMedium,
                    },
                  ]}
                >
                  {project.name}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.projectDetail,
                    { color: theme.muted, fontFamily: theme.fontBody },
                  ]}
                >
                  {[
                    project.client,
                    project.placement,
                    project.sizeIn ? `${project.sizeIn.width}×${project.sizeIn.height} in` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Add client and placement details"}
                </Text>
                {!!project.appointmentAt && (
                  <Text
                    style={[
                      styles.projectDetail,
                      { color: theme.accent, fontFamily: theme.fontBodyMedium },
                    ]}
                  >
                    {describeAppointment(project.appointmentAt)} · {formatAppointmentDate(project.appointmentAt)}
                  </Text>
                )}
                <Text
                  style={[
                    styles.projectCount,
                    { color: theme.muted, fontFamily: theme.fontBody },
                  ]}
                >
                  {project.designIds.length} attached design
                  {project.designIds.length === 1 ? "" : "s"}
                </Text>
                <View style={styles.statusRow} accessibilityRole="radiogroup">
                  {STATUS.map((item) => {
                    const active = project.status === item.id;
                    return (
                      <Pressable
                        key={item.id}
                        onPress={() => changeStatus(project, item.id)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={`${project.name}: ${item.label}`}
                        style={[
                          styles.status,
                          {
                            borderColor: active ? theme.accent : theme.line,
                            backgroundColor: active
                              ? `${theme.accent}18`
                              : theme.surfaceAlt,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusLabel,
                            {
                              color: active ? theme.accent : theme.muted,
                              fontFamily: theme.fontBodyMedium,
                            },
                          ]}
                        >
                          {item.label.toUpperCase()}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Button
                  label={proofing === project.id ? "Building proof…" : "Send proof"}
                  icon="document-text-outline"
                  loading={proofing === project.id}
                  disabled={proofing !== null}
                  onPress={() => void sendProof(project)}
                  style={{ marginTop: SPACE.sm }}
                />
              </View>
              <Icon
                name="chevronForward"
                size={SPACE.md + SPACE.xs}
                color={theme.muted}
              />
            </Pressable>
          ))
        ) : (
          <EmptyStock
            icon="projects"
            title="No client projects"
            detail="Create a project for each client. Approval state and revision notes stay private on this device until explicitly shared."
            action={{ label: "New client project", onPress: () => begin() }}
          />
        )}
      </View>
    </ScrollView>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
}) {
  const { theme } = useBrand();
  return (
    <View style={styles.fieldWrap}>
      <Text
        style={[
          styles.fieldLabel,
          { color: theme.muted, fontFamily: theme.fontBodyMedium },
        ]}
      >
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.muted}
        multiline={multiline}
        style={[
          styles.input,
          multiline && styles.multilineInput,
          {
            color: theme.foreground,
            backgroundColor: theme.surfaceAlt,
            borderColor: theme.line,
            fontFamily: theme.fontBody,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: SPACE.md, paddingTop: SPACE.lg, paddingBottom: SPACE.xxl },
  flex: { flex: 1 },
  editor: { marginTop: SPACE.md },
  fieldWrap: { marginBottom: SPACE.sm },
  fieldLabel: { ...TYPE.micro, marginBottom: SPACE.xs - 1 },
  input: {
    ...TYPE.body,
    minHeight: SPACE.xxl + 2,
    borderWidth: 1,
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACE.md - SPACE.xs + 2,
    paddingVertical: SPACE.sm,
  },
  multilineInput: {
    minHeight: SPACE.xxl * 2 - SPACE.sm,
    textAlignVertical: "top",
  },
  actions: { flexDirection: "row", gap: SPACE.sm, marginTop: SPACE.xs },
  listHeader: { marginTop: SPACE.xl },
  projectList: { gap: SPACE.sm },
  project: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACE.md - SPACE.xs + 2,
    flexDirection: "row",
    gap: SPACE.sm,
    alignItems: "flex-start",
  },
  projectIcon: {
    width: SPACE.xxl - SPACE.xs + 4,
    height: SPACE.xxl - SPACE.xs + 4,
    borderRadius: RADIUS.md,
    alignItems: "center",
    justifyContent: "center",
  },
  projectName: { ...TYPE.body },
  projectDetail: { ...TYPE.caption },
  projectCount: { ...TYPE.micro, marginTop: SPACE.xs - 3 },
  statusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACE.xs - 1,
    marginTop: SPACE.sm - 1,
  },
  status: {
    borderWidth: 1,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACE.sm - 3,
    paddingVertical: SPACE.xs - 2,
  },
  statusLabel: { ...TYPE.micro },
  designRow: { gap: SPACE.sm - 3, paddingBottom: SPACE.sm },
  design: {
    width: SPACE.xxl + SPACE.xl + SPACE.xs,
    height: SPACE.xxl + SPACE.xl + SPACE.xs,
    borderWidth: 2,
    borderRadius: RADIUS.sm,
    overflow: "hidden",
  },
  addReference: { borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
  designImage: { width: "100%", height: "100%" },
  designCheck: {
    position: "absolute",
    right: SPACE.xs - 2,
    top: SPACE.xs - 2,
    width: SPACE.md + SPACE.xs - 3,
    height: SPACE.md + SPACE.xs - 3,
    borderRadius: RADIUS.pill,
    alignItems: "center",
    justifyContent: "center",
  },
});
