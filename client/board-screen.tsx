import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { ExternalLink } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { readBoard } from "../shared/board.ts";

export function BoardScreen(props: PluginScreenProps) {
  return <HostBoard key={`${props.host.id}:${props.params.run ?? ""}`} {...props} />;
}

function HostBoard({ theme, host, layout, navigation, params }: PluginScreenProps) {
  const { colors } = theme;
  const [selectedId, select] = useState<string | undefined>(params.run);
  const read = useRpc(readBoard);
  const query = useQuery({
    queryKey: ["paseo-swarm-board", host.id, selectedId],
    queryFn: () => selectedId ? read({ id: selectedId }) : read({}),
    refetchInterval: 4000,
  });
  const { runs = [], selected } = query.data ?? {};
  const openAgent = (id: string) => navigation?.openAgent({ agentId: id, serverId: host.id });
  const panel = { borderWidth: 1, borderRadius: 10, borderColor: colors.border, backgroundColor: colors.surface1 } as const;
  const planning = selected?.stage === "planning";

  return (
    <ScrollView style={{ backgroundColor: colors.surface0 }} contentContainerStyle={{ padding: layout.compact ? 14 : 24, gap: 16 }}>
      {query.isError && <Text accessibilityRole="alert" style={{ color: colors.statusDanger }}>{query.error.message}</Text>}
      {query.isPending && <Text style={{ color: colors.foregroundMuted }}>Loading swarm board…</Text>}
      {query.isSuccess && runs.length === 0 && (
        <View style={{ ...panel, padding: 18, gap: 8 }}>
          <Text accessibilityRole="header" style={{ color: colors.foreground, fontWeight: "600", fontSize: 19 }}>Start with a plan</Text>
          <Text style={{ color: colors.foregroundMuted, lineHeight: 21 }}>Use /swarm plan in chat to review a product spec and implementation plan. Use /swarm run to start execution. Include a Linear issue link to keep it with the work.</Text>
        </View>
      )}
      <View style={{ flexDirection: layout.compact ? "column" : "row", gap: 20, alignItems: "flex-start" }}>
        {runs.length > 1 && (
          <View style={{ ...panel, width: layout.compact ? "100%" : 230, overflow: "hidden" }}>
            {runs.map((run) => (
              <Pressable
                key={run.id} accessibilityRole="button" accessibilityState={{ selected: run.id === selected?.id }}
                onPress={() => select(run.id)}
                style={{
                  minHeight: 52, paddingHorizontal: 12, paddingVertical: 8, gap: 4, justifyContent: "center", borderLeftWidth: 3,
                  borderLeftColor: run.id === selected?.id ? colors.accent : "transparent",
                  backgroundColor: run.id === selected?.id ? colors.surface2 : colors.surface1,
                }}
              >
                <Text numberOfLines={1} style={{ color: colors.foreground, fontWeight: "600" }}>{run.work}</Text>
                <Text style={{ color: run.needsDecision ? colors.statusWarning : colors.foregroundMuted, fontSize: 12 }}>
                  {run.stage === "planning" ? "Plan" : "Run"}{run.needsDecision ? " · Needs you" : ""}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        {selected && (
          <View style={{ flex: layout.compact ? undefined : 1, minWidth: 0, width: layout.compact ? "100%" : undefined, gap: 17 }}>
            <View style={{ gap: 7 }}>
              <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>
                {planning ? "Elephant & Goldfish plan" : "Execution run"}
              </Text>
              <Text accessibilityRole="header" style={{ color: colors.foreground, fontSize: layout.compact ? 23 : 28, fontWeight: "700" }}>{selected.work}</Text>
              {selected.issue && (
                <ExternalLink href={selected.issue.url} accessibilityLabel={`Open ${selected.issue.identifier} in Linear`}>
                  <Text style={{ color: colors.accent, fontWeight: "600" }}>{selected.issue.identifier} · Open in Linear ↗</Text>
                </ExternalLink>
              )}
            </View>
            {selected.decision && (
              <View style={{ ...panel, padding: 12, gap: 7, borderLeftColor: colors.statusWarning, borderLeftWidth: 3 }}>
                <Text style={{ color: colors.statusWarning, fontWeight: "600" }}>Waiting for a human decision</Text>
                <Pressable
                  accessibilityRole="button" disabled={!navigation} onPress={() => openAgent(selected.id)}
                  style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start", paddingRight: 12 }}
                >
                  <Text style={{ color: colors.accent, fontWeight: "600" }}>Open {planning ? "planning" : "lead"} chat ↗</Text>
                </Pressable>
              </View>
            )}
            <View style={{ gap: 8 }}>
              <Text accessibilityRole="header" style={{ color: colors.foreground, fontWeight: "600" }}>{planning ? "Planning chat" : "Team"}</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
                {selected.members.map(({ name, role, agentId }) => (
                  <Pressable
                    key={agentId} accessibilityRole="button" onPress={() => openAgent(agentId)} disabled={!navigation}
                    style={{ ...panel, minHeight: 44, justifyContent: "center", paddingHorizontal: 11 }}
                  >
                    <Text style={{ color: colors.foreground }}>
                      {planning ? "Open planning chat ↗" : `@${name} · ${role}`}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            {!planning && (
              <View style={{ gap: 8 }}>
                <Text accessibilityRole="header" style={{ color: colors.foreground, fontWeight: "600" }}>Activity</Text>
                {selected.posts.length === 0 && <Text style={{ color: colors.foregroundMuted }}>Waiting for the first handoff.</Text>}
                {[...selected.posts].reverse().map(({ sequence, at, from, text, mention }) => (
                  <View key={sequence} style={{ ...panel, padding: 12, gap: 6 }}>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 10 }}>
                      <Text style={{ color: colors.foreground, fontWeight: "600" }}>@{from}</Text>
                      <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{new Date(at).toLocaleTimeString()}</Text>
                    </View>
                    {mention.length > 0 && <Text style={{ color: colors.accent, fontSize: 13 }}>{mention.map((name) => `@${name}`).join(" ")}</Text>}
                    <Text selectable style={{ color: colors.foreground, lineHeight: 21 }}>{text}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
