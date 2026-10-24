import plantumlEncoder from 'plantuml-encoder';

const PLANTUML_DEFAULT_URL = 'https://www.plantuml.com/plantuml';

export default class Diagram {
    public encodedInput = '';
    public plantumlServer = PLANTUML_DEFAULT_URL;

    /**
     * Builds a Diagram object storing the encoded input value
     */
    static parse(input: string, plantumlServer?: string) {
        const diagram = new Diagram();
        diagram._encode(input);
        if (plantumlServer)
            diagram.plantumlServer = plantumlServer;

        return diagram;
    }

    /**
     * Encodes a diagram following PlantUML specs, I used `plantuml-encoder` at last.
     *
     * From https://plantuml.com/text-encoding
     * 1. Encoded in UTF-8
     * 2. Compressed using Deflate or Brotli algorithm
     * 3. Re-encoded in ASCII using a transformation close to base64
     */
    private _encode(value: string) {
        this.encodedInput = plantumlEncoder.encode(value);
    }

    async insertImgElement(container: string | HTMLElement): Promise<void> {
        const div
            = typeof container === 'string'
                ? document.getElementById(container)
                : container;
        if (div === null || !div.tagName)
            throw new Error(`Invalid container: ${container}`);

        const server = this.plantumlServer.replace(/\/+$/, '');
        const url = new URL(`${server}/svg/${this.encodedInput}`);
        if (!['https:', 'http:'].includes(url.protocol))
            throw new Error('PlantUML server must use HTTP or HTTPS.');

        const img = document.createElement('img');
        img.alt = 'PlantUML';
        await new Promise<void>((resolve, reject) => {
            const finish = (error?: Error) => {
                clearTimeout(timer);
                img.onload = null;
                img.onerror = null;
                if (error)
                    reject(error);
                else
                    resolve();
            };
            const timer = setTimeout(() => finish(new Error(
                'PlantUML server timed out. Check your network or PlantUML server settings.',
            )), 15000);
            img.onload = () => finish();
            img.onerror = () => finish(new Error(
                'PlantUML image could not be loaded. Check your network or PlantUML server settings.',
            ));
            div.replaceChildren(img);
            img.src = url.href;
        });
    }
}
