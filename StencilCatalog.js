/*
 * What the downloader is allowed to offer.
 *
 * Every entry is a raw draw.io stencil set (`<shapes>`), which is what
 * `importLibraryText` reads. The list is deliberately short: only sets whose
 * terms we can state here. Vendor cloud icons (AWS, Azure, GCP) are absent
 * because their terms allow diagrams, not redistribution as an application's
 * asset library. Kubernetes and IBM are the permissive exceptions, with their
 * own notices.
 */
"use strict";

const DRAWIO_LICENSE =
    "https://github.com/jgraph/drawio/blob/dev/src/main/webapp/stencils/LICENSE";
const DRAWIO_TERMS = Locale.Text(
    "draw.io stencil terms: not for Atlassian products; end-user diagrams exempt.");
const DRAWIO_SOURCE = "draw.io";

function drawioSet(id, name, file) {
    return {
        id: id,
        name: name,
        source: DRAWIO_SOURCE,
        license: DRAWIO_TERMS,
        licenseUrl: DRAWIO_LICENSE,
        url: "https://viewer.diagrams.net/stencils/" + file,
        extension: "xml",
    };
}

export const STENCIL_SETS = [
    drawioSet("basic", Locale.Text("Basic shapes"), "basic.xml"),
    drawioSet("flowchart", Locale.Text("Flowchart"), "flowchart.xml"),
    drawioSet("bpmn", "BPMN", "bpmn.xml"),
    drawioSet("networks", Locale.Text("Networks"), "networks.xml"),
    drawioSet("logic", Locale.Text("Electrical: IEC logic gates"),
              "electrical/iec_logic_gates.xml"),
    drawioSet("floorplan", Locale.Text("Floorplan"), "floorplan.xml"),
    drawioSet("mockup", Locale.Text("Mockup: controls"), "mockup/controls.xml"),
    drawioSet("rack", Locale.Text("Rack: general"), "rack/general.xml"),
    drawioSet("signs", Locale.Text("Signs: safety"), "signs/safety.xml"),
    drawioSet("webicons", Locale.Text("Web icons"), "webicons.xml"),
    drawioSet("pid", Locale.Text("P&ID: valves"), "pid/valves.xml"),
    drawioSet("office", Locale.Text("Office: devices"), "office/devices.xml"),
    {
        id: "kubernetes",
        name: "Kubernetes",
        source: Locale.Text("Kubernetes community, via draw.io"),
        license: Locale.Text(
            "Apache 2.0 or CC BY 4.0, Kubernetes community. Kubernetes is a Linux Foundation trademark."),
        licenseUrl: "https://github.com/kubernetes/community/blob/main/icons/README.md",
        url: "https://viewer.diagrams.net/stencils/kubernetes.xml",
        extension: "xml",
    },
    {
        id: "ibm_cloud",
        name: "IBM Cloud",
        source: Locale.Text("IBM Cloud, via draw.io"),
        license: Locale.Text(
            "Apache 2.0, IBM Cloud architecture icons. IBM and IBM Cloud are trademarks of IBM."),
        licenseUrl: "https://github.com/IBM-Cloud/architecture-icons",
        url: "https://viewer.diagrams.net/stencils/ibm_cloud.xml",
        extension: "xml",
    },
];
