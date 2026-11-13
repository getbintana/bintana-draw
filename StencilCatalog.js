/*
 * What the downloader is allowed to offer.
 *
 * Every entry is a raw draw.io stencil set (`<shapes>`), which is what
 * `importLibraryText` reads. The list is deliberately short: only sets whose
 * terms we can state here. Vendor cloud icons (AWS, Azure, GCP) are absent
 * because their terms allow diagrams, not redistribution as an application's
 * asset library. Kubernetes and IBM are the permissive exceptions, with their
 * own notices.
 *
 * `keywords` is what the filter reads beside the name: the shape names a set
 * carries, so "AND" finds the logic gates without opening every XML.
 */
"use strict";

const DRAWIO_LICENSE =
    "https://github.com/jgraph/drawio/blob/dev/src/main/webapp/stencils/LICENSE";
const DRAWIO_TERMS = Locale.Text(
    "draw.io stencil terms: not for Atlassian products; end-user diagrams exempt.");
const DRAWIO_SOURCE = "draw.io";

function drawioSet(id, name, file, group, keywords) {
    return {
        id: id,
        name: name,
        group: group,
        keywords: keywords,
        source: DRAWIO_SOURCE,
        license: DRAWIO_TERMS,
        licenseUrl: DRAWIO_LICENSE,
        url: "https://viewer.diagrams.net/stencils/" + file,
        extension: "xml",
    };
}

export const STENCIL_SETS = [
    drawioSet("basic", Locale.Text("Basic shapes"), "basic.xml",
              Locale.Text("General"),
              "star, callout, banner, arrow, cloud, shape, basic"),
    drawioSet("flowchart", Locale.Text("Flowchart"), "flowchart.xml",
              Locale.Text("Flowcharts"),
              "process, decision, data, document, terminator, loop, flow"),
    drawioSet("bpmn", "BPMN", "bpmn.xml", Locale.Text("Flowcharts"),
              "bpmn, gateway, and, or, xor, event, task, process, start, end"),
    drawioSet("logic", Locale.Text("Electrical: logic gates (ANSI)"),
              "electrical/logic_gates.xml", Locale.Text("Engineering"),
              "and, nand, nor, not, or, xor, xnor, gate, logic, ansi, compuerta"),
    drawioSet("logic_iec", Locale.Text("Electrical: IEC logic gates"),
              "electrical/iec_logic_gates.xml", Locale.Text("Engineering"),
              "and, nand, nor, not, or, xor, gate, logic, iec, rectangular, compuerta"),
    drawioSet("floorplan", Locale.Text("Floorplan"), "floorplan.xml",
              Locale.Text("Engineering"),
              "floor, plan, room, door, window, furniture, plano"),
    drawioSet("pid", Locale.Text("P&ID: valves"), "pid/valves.xml",
              Locale.Text("Engineering"),
              "pid, valve, pipe, pump, instrument, válvula"),
    drawioSet("mockup", Locale.Text("Mockup: controls"), "mockup/controls.xml",
              Locale.Text("Interface"),
              "button, control, menu, form, tab, ui, mockup"),
    drawioSet("signs", Locale.Text("Signs: safety"), "signs/safety.xml",
              Locale.Text("Interface"),
              "sign, safety, warning, fire, exit, señal"),
    drawioSet("webicons", Locale.Text("Web icons"), "webicons.xml",
              Locale.Text("Interface"),
              "web, icon, browser, social, media, internet"),
    drawioSet("office", Locale.Text("Office: devices"), "office/devices.xml",
              Locale.Text("Interface"),
              "office, device, printer, monitor, desk, oficina"),
    drawioSet("networks", Locale.Text("Networks"), "networks.xml",
              Locale.Text("Networks"),
              "network, router, switch, server, firewall, cloud, red"),
    drawioSet("rack", Locale.Text("Rack: general"), "rack/general.xml",
              Locale.Text("Networks"),
              "rack, server, network, data center, rack"),
    {
        id: "kubernetes",
        name: "Kubernetes",
        group: Locale.Text("Cloud"),
        keywords: "kubernetes, k8s, pod, service, deployment, container, cloud",
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
        group: Locale.Text("Cloud"),
        keywords: "ibm, cloud, service, compute, storage, network, watson",
        source: Locale.Text("IBM Cloud, via draw.io"),
        license: Locale.Text(
            "Apache 2.0, IBM Cloud architecture icons. IBM and IBM Cloud are trademarks of IBM."),
        licenseUrl: "https://github.com/IBM-Cloud/architecture-icons",
        url: "https://viewer.diagrams.net/stencils/ibm_cloud.xml",
        extension: "xml",
    },
];
