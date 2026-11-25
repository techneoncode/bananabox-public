package eu.bananabox.clion;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

/** Headless regression for nullable shared fields crossing the Java/JCEF bridge. */
public final class JsonTransportTest {
    public static void main(String[] args) {
        JsonObject source = JsonParser.parseString("{\"detail\":{\"prerequisitesMark\":null},\"quota\":{\"override\":null,\"remaining\":0}}").getAsJsonObject();
        JsonObject message = Host.obj("message", source, "result", null);
        JsonObject restored = JsonParser.parseString(Host.GSON.toJson(message)).getAsJsonObject();
        JsonObject data = restored.getAsJsonObject("message");
        check(data.getAsJsonObject("detail").has("prerequisitesMark"), "prerequisitesMark was dropped");
        check(data.getAsJsonObject("detail").get("prerequisitesMark").isJsonNull(), "missing mark changed value");
        check(data.getAsJsonObject("quota").has("override"), "quota override was dropped");
        check(data.getAsJsonObject("quota").get("remaining").getAsInt() == 0, "zero was lost");
        check(restored.has("result") && restored.get("result").isJsonNull(), "null response was dropped");
        System.out.println("Java/JCEF JSON transport preserves null and zero values.");
    }
    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }
}
