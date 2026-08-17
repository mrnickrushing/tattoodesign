import { Component, type ReactNode } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Without this, an uncaught render error blanks the whole screen with no
 * way back short of force-quitting the app. Catches render-phase errors in
 * the subtree beneath it and shows a recoverable fallback instead.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error("Unhandled render error", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>{this.state.error.message}</Text>
          <Pressable onPress={this.reset} style={styles.button}>
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#121110",
  },
  title: { color: "#f4f2ef", fontSize: 20, fontWeight: "600", marginBottom: 8 },
  message: { color: "#a19d98", fontSize: 14, textAlign: "center", marginBottom: 20 },
  button: {
    backgroundColor: "#da1b2e",
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  buttonText: { color: "#ffffff", fontWeight: "600" },
});
