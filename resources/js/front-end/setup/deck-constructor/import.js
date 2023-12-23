import { reset } from "../../actions/general/reset.js";
import { altDeckImportInput, failedText, importButton, loadingText, mainDeckImportInput, p1, roomId, socket, successText } from "../../front-end.js";
import { appendMessage } from "../chatbox/messages.js";
import { determineUsername } from "../general/determine-username.js";
import { getCardType } from "./find-type.js";

export const mainDeckData = [];
export const altDeckData = [];

const assembleCard = (quantity, name, set, imageURL, type) => {
    const imageAttributes = {
        src: imageURL,
        alt: name,
        draggable: true,
        click: 'imageClick',
        dblclick: 'doubleClick',
        dragstart: 'dragStart',
        dragover: 'dragOver',
        dragleave: 'dragLeave',
        dragend: 'dragEnd',
        id: 'card',
        contextmenu: 'openCardContextMenu'
    };
    const cardAttributes = {
        name: name,
        type: type,
        set: set
    };

    const rawCardAttributes = JSON.stringify(cardAttributes);
    const rawImageAttributes = JSON.stringify(imageAttributes);

    return [quantity, rawCardAttributes, rawImageAttributes];
}

export const importDecklist = (user) => {
    successText.style.display = 'none';
    failedText.style.display = 'none';
    loadingText.style.display = 'block';
    importButton.disabled = true;

    const decklist = user === 'self' ? mainDeckImportInput.value : altDeckImportInput.value;

    const regexWithSet = /(\d+) (.+?) (\w{2,3}) (\d+[a-zA-Z]?)/;
    const regexWithPRSet = /(\d+) (.+?) (PR-\w{2,3}) (\d+)/;
    const regexWithSpecialSet = /(\d+) (.+?) ((?:\w{2,3}(?:\s+[a-zA-Z\d]+)*)(?:\s+(\w{2,3}\s*[a-zA-Z\d]+)\s*)*)$/;
    const regexWithoutSet = /(\d+) (.+?)(?=\s\d|$|(\s\d+))/;
    
    // Initialize an array to store the results
    const decklistArray = [];
    
    // Split the decklist into lines
    const lines = decklist.split('\n');
    
    // Process each line
    lines.forEach(line => {
        //ptcglive conversion for GG/TG cards (the alt art bs) (don't apply to promo sets)
        line = line.replace(/(?!PR-)(\w{2,3})-(\w{2,3}) (\d+)/g, '$1 $2$3');
        //special case for double crisis set
        line = line.replace(/xy5-5/g, 'DCR');

        let matchWithSet = line.match(regexWithSet);
        let matchWithPRSet = line.match(regexWithPRSet);
        let matchWithSpecialSet = line.match(regexWithSpecialSet);
        let matchWithoutSet = line.match(regexWithoutSet);
    
        if (matchWithSet) {
            const [, quantity, name, set, setNumber] = matchWithSet;
            decklistArray.push([parseInt(quantity), name, `${set} ${setNumber}`]);
        } else if (matchWithPRSet) {
            const [, quantity, name, prSet, setNumber] = matchWithPRSet;
            decklistArray.push([parseInt(quantity), name, `${prSet} ${setNumber}`]);
        } else if (matchWithSpecialSet) {
            const [, quantity, name, set] = matchWithSpecialSet;
            decklistArray.push([parseInt(quantity), name, set.trim()]);
        } else if (matchWithoutSet) {
            const [, quantity, name] = matchWithoutSet;
            decklistArray.push([parseInt(quantity), name, '']);
        }
    });
        
    if (decklistArray.length < 1){
        loadingText.style.display = 'none';
        failedText.style.display = 'block';      
        importButton.disabled = false;
        return;
    };
    const energies = {
        'Fire Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_R_R_EN.png',
        'Grass Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_G_R_EN.png',
        'Fairy Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/TEU/TEU_Y_R_EN.png',
        'Darkness Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_D_R_EN.png',
        'Lightning Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_L_R_EN.png',
        'Fighting Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_F_R_EN.png',
        'Psychic Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_P_R_EN.png',
        'Metal Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_M_R_EN.png',
        'Water Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_W_R_EN.png',
        'Basic Fire Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_R_R_EN.png',
        'Basic Grass Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_G_R_EN.png',
        'Basic Fairy Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/TEU/TEU_Y_R_EN.png',
        'Basic Darkness Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_D_R_EN.png',
        'Basic Lightning Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_L_R_EN.png',
        'Basic Fighting Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_F_R_EN.png',
        'Basic Psychic Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_P_R_EN.png',
        'Basic Metal Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_M_R_EN.png',
        'Basic Water Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_W_R_EN.png',
        'Basic {W} Energy Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_W_R_EN.png',
        'Basic {R} Energy Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_R_R_EN.png',
        'Basic {G} Energy Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_G_R_EN.png',
        'Basic {Y} Energy Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/TEU/TEU_Y_R_EN.png',
        'Basic {D} Energy Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_D_R_EN.png',
        'Basic {L} Energy Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_L_R_EN.png',
        'Basic {F} Energy Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_F_R_EN.png',
        'Basic {P} Energy Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_P_R_EN.png',
        'Basic {M} Energy Energy': 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/BRS/BRS_M_R_EN.png'
    };

    const specialCases = {
        'PR-SV' : 'SVP',
        'PR-SW' : 'SSP',
        'PR-SM' : 'SMP',
        'PR-XY' : 'XYP',
        'PR-BLW' : 'BWP',
        'PR-HS' : 'HSP'
    }
      
    decklistArray.forEach((entry) => {
        const [q, name, set] = entry;

        const energyUrl = energies[name];

        if (energyUrl) {
            entry.push(energyUrl);
            entry.push('energy');
        } else {
            let [firstPart, secondPart] = set.split(/(?<=\S)\s/);
            if (firstPart && secondPart){
                if (specialCases[firstPart]){
                    firstPart = specialCases[firstPart];
                };
                const paddedSecondPart = secondPart.replace(/^(\d+)([a-zA-Z])?$/, (_, digits, letter) => {
                    const paddedDigits = digits.length < 3 ? digits.padStart(3, '0') : digits;
                    return letter ? paddedDigits + letter : paddedDigits;
                });
                const url = `https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/${firstPart.replace(/ /g, '/')}/${firstPart.replace(/ /g, '_')}_${paddedSecondPart}_R_EN.png`;
                entry.push(url);
                entry.push(getCardType(firstPart, secondPart));
            } else {
                loadingText.style.display = 'none';
                failedText.style.display = 'block';
            };
        };
    });      
    let deckData;
    deckData = decklistArray.map(card => assembleCard(...card));
    if (user === 'self'){
        mainDeckData[0] = deckData;
    } else {
        altDeckData[0] = deckData;
    };
    loadingText.style.display = 'none';
    if (failedText.style.display === 'none'){
        successText.style.display = 'block';
    };
    importButton.disabled = false;

    console.log(decklistArray);

    if (p1[0]){
        reset(user, true);
        appendMessage(user, determineUsername(user) + ' imported deck', 'announcement');
    } else if (user === 'self'){
        const oUser = user === 'self' ? 'opp' : 'self';
        const data = {
            roomId : roomId[0],
            deckData : mainDeckData[0],
            user: oUser
        };
        socket.emit('deckData', data);
    };
}
            
    // const url = "http://127.0.0.1:8000/deck";
    // fetch(url, {
    //     method: 'POST',
    //     headers: {
    //       'Content-Type': 'application/json'
    //     },
    //     body: JSON.stringify(decklist)
    //   })
    //     .then(response => response.json())
    //     .then(data => {
    //         loadingText.style.display = 'none';
    //         if (decklistArray.length === data.image_urls.length) {
    //             for (let i = 0; i < decklistArray.length; i++) {
    //                 decklistArray[i].push(data.image_urls[i]);
    //             };
    //             let deckData;
    //             deckData = decklistArray.map(card => assembleCard(...card));
    //             if (user === 'self'){
    //                 mainDeckData[0] = deckData;
    //             } else {
    //                 altDeckData[0] = deckData;
    //             };
    //             successText.style.display = 'block';
    //             appendMessage(user, determineUsername(user) + ' imported deck', 'announcement');
    //         } else {
    //             failedText.style.display = 'block';    
    //         };
    //         importButton.disabled = false;
    //     })
    //     .catch(error => {
    //         console.error('Error during fetch:', error);
    //         loadingText.style.display = 'none';
    //         failedText.style.display = 'block';
    //         importButton.disabled = false;
    //     });

// const decklist = [
//     [4, 'comfey', '/resources/card-scans/comfey.webp', 'pokemon'],
//     [2, 'sableye', '/resources/card-scans/sableye.webp', 'pokemon'],
//     [1, 'cramorant', '/resources/card-scans/cramorant.webp', 'pokemon'],
//     [1, 'kyogre', '/resources/card-scans/kyogre.webp', 'pokemon'],
//     [1, 'pidgeotV', '/resources/card-scans/pidgeotV.webp', 'pokemon'],
//     [1, 'manaphy', '/resources/card-scans/manaphy.webp', 'pokemon'],
//     [1, 'radiantGreninja', '/resources/card-scans/radiantGreninja.webp', 'pokemon'],
//     [1, 'zamazenta', '/resources/card-scans/zamazenta.webp', 'pokemon'],
//     [4, 'metal', '/resources/card-scans/metal.webp', 'energy'],
//     [4, 'water', '/resources/card-scans/water.webp', 'energy'],
//     [3, 'psychic', '/resources/card-scans/psychic.webp', 'energy'],
//     [4, 'colress\'sExperiment', '/resources/card-scans/colress\'sExperiment.webp', 'supporter'],
//     [4, 'battleVipPass', '/resources/card-scans/battleVipPass.webp', 'item'],
//     [4, 'mirageGate', '/resources/card-scans/mirageGate.webp', 'item'],
//     [4, 'switchCart', '/resources/card-scans/switchCart.webp', 'item'],
//     [3, 'escapeRope', '/resources/card-scans/escapeRope.webp', 'item'],
//     [4, 'nestBall', '/resources/card-scans/nestBall.jpg', 'item'],
//     [3, 'superRod', '/resources/card-scans/superRod.webp', 'item'],
//     [2, 'energyRecycler', '/resources/card-scans/energyRecycler.webp', 'item'],
//     [1, 'lostVacuum', '/resources/card-scans/lostVacuum.webp', 'item'],
//     [1, 'echoingHorn', '/resources/card-scans/echoingHorn.jpg', 'item'],
//     [1, 'hisuianHeavyBall', '/resources/card-scans/hisuianHeavyBall.webp', 'item'],
//     [1, 'roxanne', '/resources/card-scans/roxanne.webp', 'supporter'],
//     [1, 'artazon', '/resources/card-scans/artazon.webp', 'stadium'],
//     [1, 'pokestop', '/resources/card-scans/pokestop.webp', 'stadium'],
//     [1, 'beachCourt', '/resources/card-scans/beachCourt.webp', 'stadium'],
//     [2, 'forestSealStone', '/resources/card-scans/forestSealStone.webp', 'tool']
// ];