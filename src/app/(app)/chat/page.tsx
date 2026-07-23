import { listModels } from "@/lib/catalog";
import ChatClient from "./ChatClient";

export default async function ChatPage() {
  const models = await listModels();
  return <ChatClient models={models} />;
}
