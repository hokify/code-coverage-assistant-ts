const tag =
    (name: string, inline = false) =>
    (...children: any[]) => {
        const props =
            typeof children[0] === "object"
                ? Object.keys(children[0])
                      .map((key) => ` ${key}='${children[0][key]}'`)
                      .join("")
                : "";

        const c =
            typeof children[0] === "string" ? children : children.slice(1);

        return `<${name}${props}>${c.join("")}</${name}>${!inline ? "\n" : ""}`;
    };

export const tr = tag("tr");
export const td = tag("td");
export const th = tag("th");
export const b = tag("b", true);
export const table = tag("table");
export const tbody = tag("tbody");
export const a = tag("a", true);
export const span = tag("span");

export const fragment = (...children: string[]) => children.join("");
