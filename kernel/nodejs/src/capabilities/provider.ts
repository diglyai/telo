import { createCapability } from "@telorun/sdk";

export const provider = createCapability({
  name: "Provider",
  expand: {
    compile: ["**"],
  },
});
