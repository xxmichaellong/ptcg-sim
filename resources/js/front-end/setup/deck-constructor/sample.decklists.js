import { altDeckImportInput, deckImport, decklistsButton, decklistsContextMenu, mainDeckImportInput } from "../../front-end.js";

const decklistsByYear = {
    "2023-2024": {
        "Charizard": `Pokémon (17)
        3 Charmander MEW 4
        1 Charmander PR-SV 47
        1 Charmeleon OBF 27
        3 Charizard ex OBF 125
        2 Pidgey MEW 16
        2 Pidgeot ex OBF 164
        1 Rotom V CRZ 45
        1 Lumineon V BRS 40
        1 Mew CEL 11
        1 Manaphy BRS 41
        1 Jirachi PAR 126
        
        Trainer (36)
        4 Arven OBF 186
        3 Boss's Orders PAL 172
        3 Iono PAL 185
        1 Professor's Research SVI 189
        4 Battle VIP Pass FST 225
        4 Ultra Ball SVI 196
        4 Rare Candy SVI 191
        2 Level Ball BST 129
        2 Lost Vacuum CRZ 135
        2 Counter Catcher PAR 160
        1 Super Rod PAL 188
        1 Forest Seal Stone SIT 156
        1 Justified Gloves CRE 143
        1 Vitality Band SVI 197
        1 Lost City LOR 161
        1 Artazon PAL 171
        1 Collapsed Stadium BRS 137
        
        Energy (7)
        7 Fire Energy 2`,
        "Gardevoir": `Pokémon (19)
        4 Ralts ASR 60
        3 Kirlia SIT 68
        1 Kirlia CRE 60
        2 Gardevoir ex SVI 86
        2 Gardevoir CRE 61
        1 Zacian V CEL 16
        1 Scream Tail PAR 86
        1 Radiant Greninja ASR 46
        1 Manaphy BRS 41
        1 Mew CEL 11
        1 Cresselia LOR 74
        1 Jirachi PAR 126
        
        Trainer (29)
        4 Iono PAL 185
        2 Avery CRE 130
        1 Professor's Research SVI 189
        1 Boss's Orders PAL 172
        4 Battle VIP Pass FST 225
        3 Level Ball BST 129
        3 Ultra Ball SVI 196
        2 Fog Crystal CRE 140
        2 Super Rod PAL 188
        2 Counter Catcher PAR 160
        2 Rare Candy SVI 191
        1 Lost Vacuum CRZ 135
        1 Artazon PAL 171
        1 Collapsed Stadium BRS 137
        
        Energy (12)
        10 Psychic Energy 5
        2 Reversal Energy PAL 192`,
        "Lost Zone Box": `Pokémon (11)
        4 Comfey LOR 79
        1 Radiant Greninja ASR 46
        1 Cramorant LOR 50
        1 Kyogre CEL 3
        1 Sableye LOR 70
        1 Dragonite V PR-SW 154
        1 Roaring Moon ex PAR 124
        1 Iron Hands ex PAR 70
        
        Trainer (38)
        4 Colress's Experiment LOR 155
        1 Roxanne ASR 150
        1 Boss's Orders PAL 172
        4 Switch Cart ASR 154
        4 Mirage Gate LOR 163
        4 Battle VIP Pass FST 225
        3 Escape Rope BST 125
        3 Super Rod PAL 188
        3 Nest Ball SVI 181
        2 Energy Recycler BST 124
        2 Lost Vacuum CRZ 135
        1 Switch SVI 194
        1 Hisuian Heavy Ball ASR 146
        1 Pal Pad SVI 182
        2 Forest Seal Stone SIT 156
        2 PokéStop PGO 68
        
        Energy (11)
        4 Water Energy 3
        3 Darkness Energy 7
        2 Lightning Energy 4
        2 Psychic Energy 5`,
        "Lost Zone Giratina": `Pokémon (14)
        4 Comfey LOR 79
        3 Giratina V LOR 130
        3 Giratina VSTAR LOR 131
        2 Sableye LOR 70
        1 Cramorant LOR 50
        1 Radiant Greninja ASR 46
        
        Trainer (33)
        4 Colress's Experiment LOR 155
        2 Roxanne ASR 150
        1 Iono PAL 185
        1 Boss's Orders PAL 172
        4 Mirage Gate LOR 163
        4 Battle VIP Pass FST 225
        3 Nest Ball SVI 181
        2 Super Rod PAL 188
        2 Counter Catcher PAR 160
        2 Switch Cart ASR 154
        2 Escape Rope BST 125
        1 Switch SVI 194
        1 Pokégear 3.0 SVI 186
        4 Path to the Peak CRE 148
        
        Energy (13)
        4 Jet Energy PAL 190
        4 Psychic Energy 5
        3 Grass Energy 1
        2 Water Energy 3`,
        "Fusion Mew": `Pokémon (13)
        4 Mew V CRZ 60
        2 Mew VMAX FST 114
        4 Genesect V FST 185
        1 Deoxys FST 120
        1 Eiscue BRS 44
        1 Meloetta FST 124
        
        Trainer (40)
        2 Judge SVI 176
        2 Boss's Orders PAL 172
        2 Elesa's Sparkle FST 233
        1 Iono PAL 185
        1 Professor Turo's Scenario PAR 171
        4 Battle VIP Pass FST 225
        4 Ultra Ball SVI 196
        4 Power Tablet FST 236
        4 Cram-o-matic FST 229
        3 Lost Vacuum CRZ 135
        1 Feather Ball ASR 141
        1 Hisuian Heavy Ball ASR 146
        1 Nest Ball SVI 181
        1 Escape Rope BST 125
        1 Switch SVI 194
        1 Pal Pad SVI 182
        2 Forest Seal Stone SIT 156
        1 Box of Disaster LOR 154
        1 Choice Belt PAL 176
        2 Path to the Peak CRE 148
        1 Lost City LOR 161
        
        Energy (7)
        4 Fusion Strike Energy FST 244
        3 Double Turbo Energy BRS 151`,
        "Miraidon": `Pokémon (14)
        2 Miraidon ex SVI 81
        2 Iron Hands ex PAR 70
        2 Mew ex MEW 151
        1 Raikou V BRS 48
        1 Raichu V BRS 45
        1 Mareep EVS 54
        1 Flaaffy EVS 55
        1 Zapdos PGO 29
        1 Squawkabilly ex PAL 169
        1 Lumineon V BRS 40
        1 Spiritomb PAL 89
        
        Trainer (29)
        4 Peony CRE 150
        2 Boss's Orders PAL 172
        1 Raihan CRZ 140
        4 Electric Generator SVI 170
        4 Ultra Ball SVI 196
        2 Battle VIP Pass FST 225
        2 Escape Rope BST 125
        1 Switch SVI 194
        1 Nest Ball SVI 181
        1 Lost Vacuum CRZ 135
        1 Super Rod PAL 188
        2 Bravery Charm PAL 173
        1 Forest Seal Stone SIT 156
        2 Beach Court SVI 167
        1 Collapsed Stadium BRS 137
        
        Energy (17)
        16 Lightning Energy 4
        1 Double Turbo Energy BRS 151`,
        "Urshifu Inteleon": `Pokémon (18)
        3 Inteleon V FST 78
        3 Inteleon VMAX FST 79
        2 Rapid Strike Urshifu V BST 87
        2 Rapid Strike Urshifu VMAX BST 88
        2 Remoraid PAR 33
        2 Octillery BST 37
        1 Squawkabilly ex PAL 169
        1 Medicham V EVS 83
        1 Spiritomb PAL 89
        1 Radiant Alakazam SIT 59
        
        Trainer (33)
        3 Professor's Research SVI 189
        2 Iono PAL 185
        2 Korrina's Focus BST 128
        2 Melony CRE 146
        2 Klara CRE 145
        1 Professor Turo's Scenario PAR 171
        4 Battle VIP Pass FST 225
        4 Ultra Ball SVI 196
        2 Earthen Vessel PAR 163
        2 Nest Ball SVI 181
        2 Energy Retrieval SVI 171
        1 Escape Rope BST 125
        2 Forest Seal Stone SIT 156
        1 Technical Machine: Devolution PAR 177
        3 Tower of Waters BST 138
        
        Energy (9)
        5 Water Energy 3
        4 Rapid Strike Energy BST 140`,
        "Chien-Pao": `Pokémon (16)
        3 Chien-Pao ex PAL 61
        2 Frigibax PAL 57
        1 Frigibax PAL 58
        2 Bidoof CRZ 111
        2 Bibarel BRS 121
        2 Baxcalibur PAL 60
        1 Radiant Greninja ASR 46
        1 Manaphy BRS 41
        1 Iron Hands ex PAR 70
        1 Iron Bundle PAR 56
        
        Trainer (35)
        4 Irida ASR 147
        1 Iono PAL 185
        4 Battle VIP Pass FST 225
        4 Nest Ball SVI 181
        4 Ultra Ball SVI 196
        4 Superior Energy Retrieval PAL 189
        3 Rare Candy SVI 191
        3 Super Rod PAL 188
        2 Earthen Vessel PAR 163
        1 Hisuian Heavy Ball ASR 146
        1 Counter Catcher PAR 160
        4 PokéStop PGO 68
        
        Energy (9)
        8 Water Energy 3
        1 Lightning Energy 4`,
        "Snorlax Stall": `Pokémon (8)
        4 Snorlax PGO 55
        1 Rotom V CRZ 45
        1 Pidgeot V LOR 137
        1 Mimikyu PAL 97
        1 Spiritomb PAL 89
        
        Trainer (52)
        4 Arven OBF 186
        3 Penny SVI 183
        3 Iono PAL 185
        3 Miss Fortune Sisters LOR 164
        2 Boss's Orders PAL 172
        2 Erika's Invitation MEW 160
        1 Avery CRE 130
        1 Giacomo PAL 182
        1 Sidney FST 241
        1 Peonia CRE 149
        1 Cyllene ASR 138
        1 Team Yell's Cheer BRS 149
        4 Counter Catcher PAR 160
        4 Nest Ball SVI 181
        4 Pokégear 3.0 SVI 186
        2 Pal Pad SVI 182
        2 Switch Cart ASR 154
        1 Battle VIP Pass FST 225
        1 Hisuian Heavy Ball ASR 146
        1 Echoing Horn CRE 136
        1 Super Rod PAL 188
        3 Bravery Charm PAL 173
        1 Luxurious Cape PAR 166
        1 Forest Seal Stone SIT 156
        2 Temple of Sinnoh ASR 155
        2 Pokémon League Headquarters OBF 192
        
        Energy (0)`,
    },
    "2022-2023": {
        "Lugia": `Pokémon (21)
        4 Lugia V SIT 138
        3 Lugia VSTAR SIT 139
        4 Archeops SIT 147
        2 Lumineon V BRS 40
        2 Tyranitar V BST 97
        1 Single Strike Urshifu V BST 85
        1 Single Strike Urshifu VMAX BST 86
        1 Yveltal FST 175
        1 Radiant Tsareena SIT 16
        1 Pumpkaboo EVS 76
        1 Squawkabilly ex PAL 169
        
        Trainer (26)
        3 Professor's Research SVI 189
        3 Boss's Orders PAL 172
        2 Iono PAL 185
        1 Serena SIT 164
        1 Professor Burnet PR-SW 167
        4 Ultra Ball SVI 196
        4 Capturing Aroma SIT 153
        3 Urn of Vitality BST 139
        2 Nest Ball SVI 181
        2 Mesagoza SVI 178
        1 Collapsed Stadium BRS 137
        
        Energy (13)
        4 Single Strike Energy BST 141
        3 Double Turbo Energy BRS 151
        2 Gift Energy LOR 171
        2 V Guard Energy SIT 169
        2 Jet Energy PAL 190`,
        "Turbo Lost Zone Box": `Pokémon (13)
        4 Comfey LOR 79
        2 Sableye LOR 70
        1 Cramorant LOR 50
        1 Radiant Greninja ASR 46
        1 Dragonite V PR-SW 154
        1 Raikou V BRS 48
        1 Drapion V LOR 118
        1 Lumineon V BRS 40
        1 Manaphy BRS 41
        
        Trainer (39)
        4 Colress's Experiment LOR 155
        1 Boss's Orders PAL 172
        1 Klara CRE 145
        1 Roxanne ASR 150
        4 Mirage Gate LOR 163
        4 Battle VIP Pass FST 225
        4 Switch Cart ASR 154
        4 Escape Rope BST 125
        3 Nest Ball SVI 181
        3 Super Rod PAL 188
        3 Lost Vacuum CRZ 135
        1 Hisuian Heavy Ball ASR 146
        1 Ultra Ball SVI 196
        1 Pal Pad SVI 182
        2 Forest Seal Stone SIT 156
        2 PokéStop PGO 68
        
        Energy (8)
        4 Water Energy 3
        2 Psychic Energy 5
        2 Lightning Energy 4`,
        "Lost Zone Box Kyogre": `Pokémon (12)
        4 Comfey LOR 79
        2 Sableye LOR 70
        1 Cramorant LOR 50
        1 Radiant Greninja ASR 46
        1 Kyogre CEL 3
        1 Manaphy BRS 41
        1 Dragonite V PR-SW 154
        1 Pidgeot V LOR 137
        
        Trainer (37)
        4 Colress's Experiment LOR 155
        2 Roxanne ASR 150
        1 Klara CRE 145
        4 Mirage Gate LOR 163
        4 Battle VIP Pass FST 225
        4 Switch Cart ASR 154
        3 Escape Rope BST 125
        3 Nest Ball SVI 181
        2 Energy Recycler BST 124
        2 Super Rod PAL 188
        2 Lost Vacuum CRZ 135
        1 Hisuian Heavy Ball ASR 146
        1 Echoing Horn CRE 136
        2 Forest Seal Stone SIT 156
        2 Artazon PAL 171
        
        Energy (11)
        5 Water Energy 3
        4 Psychic Energy 5
        2 Lightning Energy 4`,
        "Fusion Mew": `Pokémon (13)
        4 Mew V CRZ 60
        3 Mew VMAX FST 114
        4 Genesect V FST 185
        1 Meloetta FST 124
        1 Oricorio FST 42
        
        Trainer (40)
        2 Elesa's Sparkle FST 233
        2 Boss's Orders PAL 172
        1 Iono PAL 185
        1 Judge SVI 176
        4 Power Tablet FST 236
        4 Battle VIP Pass FST 225
        4 Ultra Ball SVI 196
        4 Cram-o-matic FST 229
        2 Nest Ball SVI 181
        2 Lost Vacuum CRZ 135
        2 Switch Cart ASR 154
        1 Escape Rope BST 125
        1 Pal Pad SVI 182
        3 Forest Seal Stone SIT 156
        2 Choice Belt PAL 176
        1 Box of Disaster LOR 154
        2 Lost City LOR 161
        1 Path to the Peak CRE 148
        1 Crystal Cave EVS 144
        
        Energy (7)
        4 Fusion Strike Energy FST 244
        3 Double Turbo Energy BRS 151`,
        "Arceus Umbreon": `Pokémon (18)
        4 Arceus V BRS 122
        3 Arceus VSTAR BRS 123
        2 Umbreon V EVS 94
        2 Umbreon VMAX EVS 95
        1 Flying Pikachu V CEL 6
        1 Flying Pikachu VMAX CEL 7
        1 Spiritomb PAL 89
        1 Slaking V PGO 58
        1 Hawlucha SVI 118
        1 Radiant Alakazam SIT 59
        1 Lumineon V BRS 40
        
        Trainer (28)
        4 Iono PAL 185
        3 Boss's Orders PAL 172
        2 Professor's Research SVI 189
        1 Judge SVI 176
        1 Raihan CRZ 140
        1 Adventurer's Discovery FST 224
        4 Ultra Ball SVI 196
        4 Nest Ball SVI 181
        1 Switch SVI 194
        1 Escape Rope BST 125
        2 Choice Belt PAL 176
        3 Lost City LOR 161
        1 Path to the Peak CRE 148
        
        Energy (14)
        4 Darkness Energy 7
        4 Double Turbo Energy BRS 151
        3 Lightning Energy 4
        3 V Guard Energy SIT 169`,
        "Gardevoir": `Pokémon (18)
        3 Ralts ASR 60
        1 Ralts SIT 67
        3 Kirlia SIT 68
        1 Kirlia CRE 60
        2 Gardevoir ex SVI 86
        2 Gardevoir CRE 61
        1 Zacian V CEL 16
        1 Cresselia LOR 74
        1 Mew CEL 11
        1 Radiant Greninja ASR 46
        1 Manaphy BRS 41
        1 Lumineon V BRS 40
        
        Trainer (30)
        3 Iono PAL 185
        2 Professor's Research SVI 189
        2 Boss's Orders PAL 172
        4 Battle VIP Pass FST 225
        4 Level Ball BST 129
        3 Ultra Ball SVI 196
        3 Rare Candy SVI 191
        2 Fog Crystal CRE 140
        2 Super Rod PAL 188
        1 Lost Vacuum CRZ 135
        1 Pal Pad SVI 182
        1 Forest Seal Stone SIT 156
        1 Artazon PAL 171
        1 Collapsed Stadium BRS 137
        
        Energy (12)
        10 Psychic Energy 5
        2 Reversal Energy PAL 192`,
        "Palkia": `Pokémon (15)
        4 Origin Forme Palkia V ASR 39
        3 Origin Forme Palkia VSTAR ASR 40
        2 Chien-Pao ex PAL 61
        1 Radiant Greninja ASR 46
        1 Bidoof CRZ 111
        1 Bibarel BRS 121
        1 Lumineon V BRS 40
        1 Articuno SIT 36
        1 Spiritomb PAL 89
        
        Trainer (35)
        4 Irida ASR 147
        3 Iono PAL 185
        2 Melony CRE 146
        2 Boss's Orders PAL 172
        4 Battle VIP Pass FST 225
        4 Ultra Ball SVI 196
        4 Cross Switcher FST 230
        3 Switch SVI 194
        2 Escape Rope BST 125
        2 Nest Ball SVI 181
        1 Hisuian Heavy Ball ASR 146
        1 Energy Search SVI 172
        3 Lost City LOR 161
        
        Energy (10)
        10 Water Energy 3`,
    },
    "2021-2022": {
        "Arceus Flying Pikachu": `Pokémon (23)
        4 Arceus V BRS 122
        3 Arceus VSTAR BRS 123
        3 Flying Pikachu V CEL 6
        2 Flying Pikachu VMAX CEL 7
        2 Hisuian Decidueye V ASR 83
        2 Hisuian Decidueye VSTAR ASR 84
        2 Bidoof BRS 120
        2 Bibarel BRS 121
        1 Crobat V SHF 44
        1 Lumineon V BRS 40
        1 Pumpkaboo EVS 76
        
        Trainer (25)
        4 Marnie CPA 56
        4 Boss's Orders BRS 132
        2 Professor's Research BRS 147
        1 Raihan EVS 152
        4 Quick Ball FST 237
        4 Ultra Ball BRS 150
        1 Evolution Incense SSH 163
        1 Switch SSH 183
        4 Path to the Peak CRE 148
        
        Energy (12)
        4 Double Turbo Energy BRS 151
        4 Lightning Energy 4
        3 Fighting Energy 6
        1 Capture Energy RCL 171`,
        "Palkia Inteleon": `Pokémon (19)
        3 Origin Forme Palkia V ASR 39
        3 Origin Forme Palkia VSTAR ASR 40
        4 Sobble CRE 41
        3 Drizzile SSH 56
        1 Inteleon SSH 58
        1 Inteleon CRE 43
        1 Radiant Greninja ASR 46
        1 Crabominable V FST 76
        1 Manaphy BRS 41
        1 Galarian Zigzagoon SSH 117
        
        Trainer (34)
        4 Irida ASR 147
        2 Melony CRE 146
        1 Boss's Orders BRS 132
        1 Roxanne ASR 150
        4 Cross Switcher FST 230
        4 Battle VIP Pass FST 225
        3 Capacious Bucket RCL 156
        3 Scoop Up Net RCL 165
        3 Evolution Incense SSH 163
        2 Quick Ball FST 237
        2 Level Ball BST 129
        1 Hisuian Heavy Ball ASR 146
        1 Echoing Horn CRE 136
        1 Choice Belt BRS 135
        1 Tool Jammer BST 136
        1 Training Court RCL 169
        
        Energy (7)
        7 Water Energy 3`,
        "Fusion Mew": `Pokémon (14)
        4 Mew V FST 113
        3 Mew VMAX FST 114
        4 Genesect V FST 185
        2 Meloetta FST 124
        1 Pumpkaboo EVS 76
        
        Trainer (39)
        3 Elesa's Sparkle FST 233
        3 Boss's Orders BRS 132
        4 Power Tablet FST 236
        4 Battle VIP Pass FST 225
        4 Quick Ball FST 237
        4 Ultra Ball BRS 150
        4 Cram-o-matic FST 229
        4 Rotom Phone CPA 64
        2 Switch SSH 183
        2 Escape Rope BST 125
        1 Echoing Horn CRE 136
        2 Choice Belt BRS 135
        2 Rose Tower DAA 169
        
        Energy (7)
        4 Fusion Strike Energy FST 244
        3 Double Turbo Energy BRS 151`,
        "Ice Rider Calyrex Palkia": `Pokémon (19)
        3 Ice Rider Calyrex V CRE 45
        2 Ice Rider Calyrex VMAX CRE 46
        2 Origin Forme Palkia V ASR 39
        2 Origin Forme Palkia VSTAR ASR 40
        2 Bidoof BRS 120
        2 Bibarel BRS 121
        1 Radiant Greninja ASR 46
        1 Empoleon V BST 40
        1 Crobat V SHF 44
        1 Pyukumuku FST 77
        1 Mew CEL 11
        1 Pumpkaboo EVS 76
        
        Trainer (33)
        4 Irida ASR 147
        3 Melony CRE 146
        4 Cross Switcher FST 230
        4 Quick Ball FST 237
        4 Ultra Ball BRS 150
        4 Trekking Shoes ASR 156
        2 Capacious Bucket RCL 156
        1 Battle VIP Pass FST 225
        1 Tool Scrapper RCL 168
        1 Canceling Cologne ASR 136
        1 Switch SSH 183
        2 Choice Belt BRS 135
        1 Air Balloon SSH 156
        1 Training Court RCL 169
        
        Energy (8)
        8 Water Energy 3`,
        "Charizard Inteleon": `Pokémon (14)
        4 Sobble CRE 41
        3 Drizzile SSH 56
        2 Inteleon SSH 58
        1 Radiant Charizard PGO 11
        1 Mew CEL 11
        1 Snorlax VIV 131
        1 Manaphy BRS 41
        1 Galarian Zigzagoon SSH 117
        
        Trainer (41)
        4 Irida ASR 147
        2 Raihan EVS 152
        2 Klara CRE 145
        1 Boss's Orders BRS 132
        4 Cross Switcher FST 230
        4 Scoop Up Net RCL 165
        4 Level Ball BST 129
        3 Quick Ball FST 237
        3 Evolution Incense SSH 163
        3 Energy Search SSH 161
        1 Hisuian Heavy Ball ASR 146
        1 Ordinary Rod SSH 171
        1 Rescue Carrier EVS 154
        1 Rare Candy PGO 69
        1 Tool Scrapper RCL 168
        2 Choice Belt BRS 135
        1 Air Balloon SSH 156
        3 Magma Basin BRS 144
        
        Energy (5)
        2 Fire Energy 2
        2 Water Energy 3
        1 Twin Energy RCL 174`,
        "Regis": `Pokémon (12)
        2 Regieleki EVS 60
        2 Regidrago ASR 118
        2 Regigigas ASR 130
        2 Regice ASR 37
        2 Regirock ASR 75
        2 Registeel ASR 108
        
        Trainer (37)
        4 Professor's Research BRS 147
        3 Marnie CPA 56
        2 Cynthia's Ambition BRS 138
        2 Boss's Orders BRS 132
        4 Ordinary Rod SSH 171
        4 Scoop Up Net RCL 165
        4 Quick Ball FST 237
        3 Ultra Ball BRS 150
        2 Energy Loto ASR 140
        1 Hisuian Heavy Ball ASR 146
        4 Choice Belt BRS 135
        4 PokéStop PGO 68
        
        Energy (11)
        4 Aurora Energy SSH 186
        3 Speed Lightning Energy RCL 173
        2 Capture Energy RCL 171
        2 Twin Energy RCL 174`,
        "Arceus Inteleon": `Pokémon (17)
        4 Arceus V BRS 122
        3 Arceus VSTAR BRS 123
        4 Sobble CRE 41
        3 Drizzile SSH 56
        2 Inteleon SSH 58
        1 Oranguru SSH 148
        
        Trainer (32)
        4 Marnie CPA 56
        2 Cheren's Care BRS 134
        1 Boss's Orders BRS 132
        1 Melony CRE 146
        1 Roxanne ASR 150
        4 Quick Ball FST 237
        4 Ultra Ball BRS 150
        4 Level Ball BST 129
        2 Evolution Incense SSH 163
        2 Scoop Up Net RCL 165
        2 Pal Pad SSH 172
        2 Big Charm SSH 158
        2 Path to the Peak CRE 148
        1 Dyna Tree Hill CRE 135
        
        Energy (11)
        6 Water Energy 3
        4 Double Turbo Energy BRS 151
        1 Capture Energy RCL 171`,
    },
    "2020-2021": {
        "Urshifu Inteleon": `Pokémon (23)
        4 Rapid Strike Urshifu V BST 87
        3 Rapid Strike Urshifu VMAX BST 88
        4 Sobble CRE 41
        4 Drizzile SSH 56
        3 Inteleon CRE 43
        1 Inteleon SSH 58
        1 Passimian CRE 88
        1 Mew UNB 76
        1 Dedenne-GX UNB 57
        1 Jirachi-GX UNM 79
        
        Trainer (29)
        4 Professor's Research SHF 60
        3 Marnie CPA 56
        2 Boss's Orders SHF 58
        4 Quick Ball SSH 179
        4 Level Ball BST 129
        2 Evolution Incense SSH 163
        2 Pokémon Communication TEU 152
        1 Switch SSH 183
        1 Escape Rope BST 125
        1 Reset Stamp UNM 206
        1 Tool Scrapper RCL 168
        2 Karate Belt UNM 201
        1 Air Balloon SSH 156
        1 Tower of Waters BST 138
        
        Energy (8)
        4 Rapid Strike Energy BST 140
        4 Fighting Energy 6`,
        "Spiritomb": `Pokémon (14)
        4 Spiritomb UNB 112
        3 Jirachi TEU 99
        1 Jynx UNM 76
        1 Hoopa UNM 140
        1 Mewtwo UNB 75
        1 Mew UNB 76
        1 Marshadow UNB 81
        1 Oricorio-GX CEC 95
        1 Dedenne-GX UNB 57
        
        Trainer (39)
        4 Professor's Research SHF 60
        3 Bird Keeper DAA 159
        2 Boss's Orders SHF 58
        4 Quick Ball SSH 179
        4 Level Ball BST 129
        4 Switch SSH 183
        4 Escape Rope BST 125
        4 Scoop Up Net RCL 165
        2 Ordinary Rod SSH 171
        4 Cape of Toughness DAA 160
        4 Spikemuth DAA 170
        
        Energy (7)
        4 Hiding Darkness Energy DAA 175
        3 Darkness Energy 7`,
        "ADP Moltres": `Pokémon (14)
        4 Galarian Moltres V CRE 97
        3 Dedenne-GX UNB 57
        2 Arceus & Dialga & Palkia-GX CEC 156
        1 Cobalion-GX TEU 106
        1 Galarian Zapdos V CRE 80
        1 Crobat V SHF 44
        1 Eldegoss V CPA 5
        1 Marshadow UNB 81
        
        Trainer (33)
        4 Boss's Orders SHF 58
        4 Professor's Research SHF 60
        3 Marnie CPA 56
        4 Quick Ball SSH 179
        4 Cherish Ball UNM 191
        3 Switch SSH 183
        2 Reset Stamp UNM 206
        1 Energy Switch SSH 162
        1 Great Catcher CEC 192
        3 Air Balloon SSH 156
        4 Viridian Forest TEU 156
        
        Energy (13)
        7 Darkness Energy 7
        4 Aurora Energy SSH 186
        1 Metal Energy 8
        1 Water Energy 3`,
        "Shadow Rider Calyrex": `Pokémon (16)
        4 Shadow Rider Calyrex V CRE 74
        4 Shadow Rider Calyrex VMAX CRE 75
        2 Dedenne-GX UNB 57
        2 Marshadow UNB 81
        1 Alcremie V CPA 22
        1 Alcremie VMAX CPA 23
        1 Gengar & Mimikyu-GX TEU 53
        1 Cresselia CRE 64
        
        Trainer (31)
        4 Professor's Research SHF 60
        3 Marnie CPA 56
        3 Boss's Orders SHF 58
        4 Fog Crystal CRE 140
        4 Quick Ball SSH 179
        3 Evolution Incense SSH 163
        2 Switch SSH 183
        2 Ordinary Rod SSH 171
        1 Reset Stamp UNM 206
        3 Air Balloon SSH 156
        2 Path to the Peak CRE 148
        
        Energy (13)
        13 Psychic Energy 5`,
        "Weavile Dark Box": `Pokémon (20)
        3 Sneasel CEC 43
        2 Weavile-GX UNM 132
        2 Malamar V RCL 121
        2 Malamar VMAX RCL 122
        2 Galarian Moltres V CRE 97
        2 Dedenne-GX UNB 57
        1 Mewtwo & Mew-GX UNM 71
        1 Umbreon & Darkrai-GX UNM 125
        1 Mega Sableye & Tyranitar-GX UNM 126
        1 Guzzlord CEC 136
        1 Eldegoss V CPA 5
        1 Mew UNB 76
        1 Marshadow UNB 81
        
        Trainer (31)
        3 Professor's Research SHF 60
        3 Marnie CPA 56
        2 Boss's Orders SHF 58
        2 Red & Blue CEC 202
        1 Cynthia & Caitlin CEC 189
        1 Mallow & Lana CEC 198
        1 Cheryl BST 123
        1 Phoebe BST 130
        4 Quick Ball SSH 179
        3 Pokémon Communication TEU 152
        3 Tag Call CEC 206
        1 Ordinary Rod SSH 171
        3 Air Balloon SSH 156
        2 Chaotic Swell CEC 187
        1 Viridian Forest TEU 156
        
        Energy (9)
        8 Darkness Energy 7
        1 Capture Energy RCL 171`,
    },
    "2019-2020": {
        "Zacian Lucario & Melmetal": `Pokémon (12)
        4 Zacian V SSH 138
        2 Lucario & Melmetal-GX UNB 120
        2 Zamazenta V SSH 139
        2 Bronzor TEU 100
        2 Bronzong TEU 101
        
        Trainer (35)
        4 Professor's Research SSH 178
        3 Marnie SSH 169
        2 Boss's Orders RCL 154
        2 Mallow & Lana CEC 198
        1 Cynthia & Caitlin CEC 189
        4 Quick Ball SSH 179
        4 Pokémon Communication TEU 152
        4 Metal Saucer SSH 170
        4 Switch SSH 183
        3 Tag Call CEC 206
        4 Metal Goggles TEU 148
        
        Energy (13)
        13 Metal Energy 8`,
        "Zacian ADP": `Pokémon (13)
        4 Zacian V SSH 138
        2 Arceus & Dialga & Palkia-GX CEC 156
        2 Zamazenta V SSH 139
        2 Dedenne-GX UNB 57
        1 Crobat V DAA 104
        1 Eldegoss V RCL 19
        1 Oranguru SSH 148
        
        Trainer (36)
        4 Professor's Research SSH 178
        3 Boss's Orders RCL 154
        2 Guzma & Hala CEC 193
        1 Cynthia & Caitlin CEC 189
        1 Mallow & Lana CEC 198
        1 Marnie SSH 169
        1 Red's Challenge UNB 184
        4 Quick Ball SSH 179
        4 Metal Saucer SSH 170
        4 Switch SSH 183
        4 Tag Call CEC 206
        1 Great Catcher CEC 192
        2 Air Balloon SSH 156
        2 Metal Goggles TEU 148
        1 Giant Bomb UNM 196
        1 Chaotic Swell CEC 187
        
        Energy (11)
        8 Metal Energy 8
        2 Aurora Energy SSH 186
        1 Capture Energy RCL 171`,
        "Inteleon Frosmoth": `Pokémon (20)
        4 Inteleon V RCL 49
        3 Inteleon VMAX RCL 50
        3 Snom SSH 63
        2 Frosmoth SSH 64
        2 Dedenne-GX UNB 57
        2 Crobat V DAA 104
        2 Galarian Zigzagoon SSH 117
        1 Lapras V SSH 49
        1 Suicune DAA 37
        
        Trainer (31)
        4 Professor's Research SSH 178
        4 Marnie SSH 169
        3 Boss's Orders RCL 154
        4 Quick Ball SSH 179
        4 Pokémon Communication TEU 152
        3 Scoop Up Net RCL 165
        2 Evolution Incense SSH 163
        2 Capacious Bucket RCL 156
        3 Air Balloon SSH 156
        2 Training Court RCL 169
        
        Energy (9)
        9 Water Energy 3`,
        "Centiskorch": `Pokémon (14)
        4 Centiskorch V DAA 33
        3 Centiskorch VMAX DAA 34
        2 Volcanion UNB 25
        1 Victini V SSH 25
        1 Heatran-GX UNM 25
        1 Dedenne-GX UNB 57
        1 Crobat V DAA 104
        1 Eldegoss V RCL 19
        
        Trainer (33)
        4 Welder UNB 189
        2 Boss's Orders RCL 154
        2 Cynthia & Caitlin CEC 189
        1 Mallow & Lana CEC 198
        4 Pokégear 3.0 SSH 174
        4 Quick Ball SSH 179
        4 Pokémon Communication TEU 152
        4 Switch SSH 183
        2 Fire Crystal UNB 173
        2 Reset Stamp UNM 206
        2 Big Charm SSH 158
        2 Giant Hearth UNM 197
        
        Energy (13)
        9 Fire Energy 2
        4 Heat Fire Energy DAA 174`,
        "Eternatus": `Pokémon (18)
        4 Eternatus V DAA 116
        4 Eternatus VMAX DAA 117
        4 Crobat V DAA 104
        4 Galarian Zigzagoon SSH 117
        1 Hoopa DAA 111
        1 Hoopa UNM 140
        
        Trainer (32)
        4 Marnie SSH 169
        4 Boss's Orders RCL 154
        3 Professor's Research SSH 178
        4 Quick Ball SSH 179
        4 Great Ball SSH 164
        3 Scoop Up Net RCL 165
        3 Turbo Patch DAA 172
        2 Pokémon Communication TEU 152
        2 Air Balloon SSH 156
        2 Viridian Forest TEU 156
        1 Black Market ♢ TEU 134
        
        Energy (10)
        8 Darkness Energy 7
        2 Capture Energy RCL 171`,
    },
    "2018-2019": {
        "Mewtwo & Mew": `Pokémon (16)
        4 Mewtwo & Mew-GX UNM 71
        3 Dedenne-GX UNB 57
        1 Solgaleo-GX PR-SM 104
        1 Reshiram & Charizard-GX UNB 20
        1 Magcargo-GX LOT 44
        1 Latios-GX UNM 78
        1 Espeon & Deoxys-GX UNM 72
        1 Naganadel-GX UNM 160
        1 Jirachi-GX UNM 79
        1 Cobalion-GX TEU 106
        1 Marshadow UNB 81
        
        Trainer (33)
        4 Welder UNB 189
        2 Bill's Analysis TEU 133
        4 Pokégear 3.0 UNB 182
        4 Acro Bike CES 123
        4 Cherish Ball UNM 191
        4 Custom Catcher LOT 171
        3 Mysterious Treasure FLI 113
        2 Switch CES 147
        1 Electromagnetic Radar UNB 169
        1 Fire Crystal UNB 173
        3 Giant Hearth UNM 197
        1 Viridian Forest TEU 156
        
        Energy (11)
        8 Fire Energy 2
        3 Psychic Energy 5`,
        "Blacephalon Naganadel": `Pokémon (16)
        3 Blacephalon-GX LOT 52
        3 Poipole FLI 55
        1 Poipole LOT 107
        3 Naganadel LOT 108
        2 Naganadel-GX UNM 160
        2 Heatran-GX UNM 25
        1 Dedenne-GX UNB 57
        1 Mew UNB 76
        
        Trainer (28)
        4 Welder UNB 189
        4 Cynthia UPR 119
        1 Lillie UPR 125
        1 Hapu UNM 200
        4 Custom Catcher LOT 171
        4 Mysterious Treasure FLI 113
        3 Beast Ring FLI 102
        3 Cherish Ball UNM 191
        1 Reset Stamp UNM 206
        2 Ultra Space FLI 115
        1 Heat Factory ♢ LOT 178
        
        Energy (16)
        14 Fire Energy 2
        1 Psychic Energy 5
        1 Beast Energy ♢ FLI 117`,
        "Green's Reshiram & Charizard": `Pokémon (7)
        4 Volcanion UNB 25
        3 Reshiram & Charizard-GX UNB 20
        
        Trainer (42)
        4 Welder UNB 189
        4 Green's Exploration UNB 175
        1 Lusamine CIN 96
        4 Pokégear 3.0 UNB 182
        4 Custom Catcher LOT 171
        4 Mixed Herbs LOT 184
        4 Great Potion UNM 198
        4 Acro Bike CES 123
        3 Fire Crystal UNB 173
        2 Cherish Ball UNM 191
        1 Reset Stamp UNM 206
        1 Fiery Flint DRM 60
        1 Energy Spinner UNB 170
        1 Giant Hearth UNM 197
        1 Power Plant UNB 183
        1 Shrine of Punishment CES 143
        1 Lysandre Labs FLI 111
        1 Heat Factory ♢ LOT 178
        
        Energy (11)
        11 Fire Energy 2`,
        "Reshiram & Charizard Fire Box": `Pokémon (16)
        4 Jirachi TEU 99
        3 Dedenne-GX UNB 57
        2 Reshiram & Charizard-GX UNB 20
        1 Heatran-GX UNM 25
        1 Victini ♢ DRM 7
        1 Turtonator DRM 50
        2 Vulpix TEU 15
        2 Ninetales TEU 16
        
        Trainer (26)
        4 Welder UNB 189
        4 Cherish Ball UNM 191
        3 Pokémon Communication TEU 152
        3 Acro Bike CES 123
        3 Super Scoop Up CES 146
        2 Switch CES 147
        1 Pal Pad UPR 132
        2 Escape Board UPR 122
        3 Giant Hearth UNM 197
        1 Heat Factory ♢ LOT 178
        
        Energy (18)
        18 Fire Energy 2`,
        "Pikachu & Zekrom": `Pokémon (13)
        3 Jirachi TEU 99
        2 Pikachu & Zekrom-GX TEU 33
        2 Raichu & Alolan Raichu-GX UNM 54
        2 Dedenne-GX UNB 57
        1 Zeraora-GX LOT 86
        1 Sigilyph-GX LOT 98
        1 Zapdos TEU 40
        1 Tapu Koko ♢ TEU 51
        
        Trainer (36)
        4 Lillie UPR 125
        3 Volkner UPR 135
        1 Cyrus ♢ UPR 120
        4 Electropower LOT 172
        4 Custom Catcher LOT 171
        4 Switch CES 147
        3 Electromagnetic Radar UNB 169
        2 Pokémon Communication TEU 152
        2 Reset Stamp UNM 206
        2 Energy Switch CES 129
        1 Tag Switch UNM 209
        1 Cherish Ball UNM 191
        1 Stadium Nav UNM 208
        1 Escape Board UPR 122
        2 Lysandre Labs FLI 111
        1 Thunder Mountain ♢ LOT 191
        
        Energy (11)
        11 Lightning Energy 4`,
        "Pidgeotto Control": `Pokémon (18)
        4 Oranguru UPR 114
        4 Pidgey TEU 121
        4 Pidgeotto TEU 123
        2 Girafarig LOT 94
        2 Articuno-GX CES 31
        1 Ditto ♢ LOT 154
        1 Mew UNB 76
        
        Trainer (38)
        4 Professor Elm's Lecture LOT 188
        2 Cynthia UPR 119
        2 Tate & Liza CES 148
        2 Mars UPR 128
        2 Lt. Surge's Strategy UNB 178
        1 Brock's Grit TEU 135
        4 Pokégear 3.0 UNB 182
        4 Acro Bike CES 123
        4 Crushing Hammer SUM 115
        3 Custom Catcher LOT 171
        2 Reset Stamp UNM 206
        2 Chip-Chip Ice Axe UNB 165
        2 Pokémon Communication TEU 152
        2 Pal Pad UPR 132
        2 Power Plant UNB 183
        
        Energy (4)
        3 Water Energy 3
        1 Recycle Energy UNM 212`,
        "Gardevoir & Sylveon": `Pokémon (6)
        4 Gardevoir & Sylveon-GX UNB 130
        1 Xerneas-GX FLI 90
        1 Mimikyu-GX LOT 149
        
        Trainer (45)
        4 Green's Exploration UNB 175
        3 Judge FLI 108
        2 Erika's Hospitality TEU 140
        2 Cynthia UPR 119
        2 Bill's Analysis TEU 133
        4 Pokégear 3.0 UNB 182
        4 Switch CES 147
        3 Cherish Ball UNM 191
        3 Great Potion UNM 198
        2 Custom Catcher LOT 171
        2 Tag Switch UNM 209
        2 Energy Spinner UNB 170
        1 Reset Stamp UNM 206
        1 Adventure Bag LOT 167
        2 Fairy Charm Lightning UNB 172
        2 Fairy Charm UB TEU 142
        1 Fairy Charm Psychic LOT 175
        4 Power Plant UNB 183
        1 Wondrous Labyrinth ♢ TEU 158
        
        Energy (9)
        9 Fairy Energy 9`,
    },
    "2017-2018": {
        "Zoroark Garbodor": `Pokémon (18)
        4 Zorua SLG 52
        4 Zoroark-GX SLG 53
        3 Trubbish BKP 56
        2 Garbodor GRI 51
        1 Garbodor BKP 57
        3 Tapu Lele-GX GRI 60
        1 Kartana-GX CIN 70
        
        Trainer (35)
        4 N FCO 105
        3 Brigette BKT 134
        2 Guzma BUS 115
        1 Professor Sycamore BKP 107
        1 Cynthia UPR 119
        4 Puzzle of Time BKP 109
        4 Mysterious Treasure FLI 113
        3 Evosoda GEN 62
        3 Field Blower GRI 125
        1 Rescue Stretcher GRI 130
        1 Enhanced Hammer GRI 124
        1 Town Map BKT 150
        3 Float Stone BKT 137
        2 Choice Band GRI 121
        2 Parallel City BKT 145
        
        Energy (7)
        4 Double Colorless Energy SLG 69
        3 Unit Energy LPM UPR 138`,
        "Psychic Malamar": `Pokémon (18)
        4 Inkay FLI 50
        4 Malamar FLI 51
        2 Marshadow-GX BUS 80
        1 Dawn Wings Necrozma-GX UPR 63
        1 Necrozma-GX BUS 63
        1 Mewtwo-GX SLG 39
        1 Tapu Lele-GX GRI 60
        1 Lunala ♢ UPR 62
        1 Mimikyu GRI 58
        1 Giratina PR-XY 184
        1 Oranguru SUM 113
        
        Trainer (32)
        4 Professor Sycamore BKP 107
        4 Cynthia UPR 119
        3 Guzma BUS 115
        1 Lillie UPR 125
        4 Mysterious Treasure FLI 113
        4 Ultra Ball SLG 68
        3 Acro Bike CES 123
        2 Field Blower GRI 125
        2 Max Elixir BKP 102
        1 Rescue Stretcher GRI 130
        4 Float Stone BKT 137
        
        Energy (10)
        10 Psychic Energy 5`,
        "Zygarde Lycanroc": `Pokémon (13)
        3 Zygarde-GX FLI 73
        2 Rockruff FLI 75
        2 Lycanroc-GX GRI 74
        1 Buzzwole FLI 77
        1 Buzzwole-GX CIN 57
        1 Diancie ♢ FLI 74
        1 Regirock-EX FCO 43
        1 Tapu Lele-GX GRI 60
        1 Oranguru SUM 113
        
        Trainer (31)
        4 Professor Sycamore BKP 107
        3 N FCO 105
        3 Guzma BUS 115
        2 Cynthia UPR 119
        4 Ultra Ball SLG 68
        3 Max Elixir BKP 102
        1 Field Blower GRI 125
        1 Rescue Stretcher GRI 130
        3 Choice Band GRI 121
        3 Float Stone BKT 137
        2 Brooklet Hill GRI 120
        2 Scorched Earth FCO 110
        
        Energy (16)
        10 Fighting Energy 6
        4 Double Colorless Energy SLG 69
        2 Strong Energy FCO 115`,
        "Rayquaza": `Pokémon (9)
        4 Rayquaza-GX CES 109
        2 Marshadow SLG 45
        1 Tapu Lele-GX GRI 60
        1 Xurkitree-GX PR-SM 68
        1 Oranguru SUM 113
        
        Trainer (37)
        4 Professor Sycamore BKP 107
        4 Guzma BUS 115
        1 Lillie UPR 125
        4 Puzzle of Time BKP 109
        4 Mysterious Treasure FLI 113
        4 Max Elixir BKP 102
        3 Acro Bike CES 123
        2 Ultra Ball SLG 68
        2 Rescue Stretcher GRI 130
        2 Field Blower GRI 125
        1 Super Rod BKT 149
        1 Escape Rope BUS 114
        3 Choice Band GRI 121
        2 Float Stone BKT 137
        
        Energy (14)
        7 Grass Energy 1
        7 Lightning Energy 4`,
        "Buzzwole Lycanroc": `Pokémon (14)
        3 Buzzwole FLI 77
        2 Buzzwole-GX CIN 57
        2 Rockruff FLI 75
        2 Lycanroc-GX GRI 74
        1 Diancie ♢ FLI 74
        2 Remoraid BKT 32
        1 Octillery BKT 33
        1 Tapu Lele-GX GRI 60
        
        Trainer (32)
        4 Professor Sycamore BKP 107
        4 Guzma BUS 115
        2 N FCO 105
        2 Cynthia UPR 119
        4 Ultra Ball SLG 68
        4 Max Elixir BKP 102
        3 Beast Ring FLI 102
        1 Super Rod BKT 149
        3 Choice Band GRI 121
        2 Float Stone BKT 137
        3 Brooklet Hill GRI 120
        
        Energy (14)
        9 Fighting Energy 6
        4 Strong Energy FCO 115
        1 Beast Energy ♢ FLI 117`,
        "Greninja": `Pokémon (17)
        4 Froakie FLI 22
        3 Frogadier BKP 39
        1 Frogadier FLI 23
        4 Greninja BKP 40
        3 Greninja BREAK BKP 41
        1 Staryu BKP 25
        1 Starmie EVO 31
        
        Trainer (33)
        4 Professor Sycamore BKP 107
        4 Cynthia UPR 119
        4 N FCO 105
        4 Ultra Ball SLG 68
        4 Evosoda GEN 62
        4 Enhanced Hammer GRI 124
        3 Max Potion GRI 128
        2 Super Rod BKT 149
        1 Rescue Stretcher GRI 130
        3 Brooklet Hill GRI 120
        
        Energy (10)
        6 Water Energy 3
        4 Splash Energy BKP 113`,
        "Zoroark Gallade": `Pokémon (19)
        4 Zorua SLG 52
        4 Zoroark-GX SLG 53
        4 Tapu Lele-GX GRI 60
        2 Ralts BKT 100
        2 Gallade BKT 84
        1 Oranguru UPR 114
        1 Mew-EX DRX 46
        1 Sylveon-EX GEN RC21
        
        Trainer (37)
        3 N FCO 105
        2 Professor Sycamore BKP 107
        2 Brigette BKT 134
        2 Guzma BUS 115
        1 Cynthia UPR 119
        1 Mallow GRI 127
        1 Professor Kukui SUM 128
        1 Acerola BUS 112
        1 Team Flare Grunt GEN 73
        1 Team Skull Grunt SUM 133
        1 Gladion CIN 95
        4 Puzzle of Time BKP 109
        4 Ultra Ball SLG 68
        2 Rare Candy CES 142
        2 Field Blower GRI 125
        2 Crushing Hammer SUM 115
        1 Enhanced Hammer GRI 124
        1 Max Potion GRI 128
        1 Rescue Stretcher GRI 130
        1 Counter Catcher CIN 91
        1 Pal Pad UPR 132
        1 Choice Band GRI 121
        1 Float Stone BKT 137
        
        Energy (4)
        4 Double Colorless Energy SLG 69`,
        "Banette Garbodor": `Pokémon (16)
        4 Trubbish BKP 56
        2 Garbodor BKP 57
        2 Garbodor GRI 51
        2 Shuppet CES 63
        2 Banette-GX CES 66
        2 Tapu Lele-GX GRI 60
        1 Drampa-GX GRI 115
        1 Buzzwole FLI 77
        
        Trainer (33)
        4 Professor Sycamore BKP 107
        4 N FCO 105
        3 Cynthia UPR 119
        3 Guzma BUS 115
        1 Brigette BKT 134
        3 Ultra Ball SLG 68
        2 Mysterious Treasure FLI 113
        2 Field Blower GRI 125
        2 Rescue Stretcher GRI 130
        4 Float Stone BKT 137
        3 Choice Band GRI 121
        2 Parallel City BKT 145
        
        Energy (11)
        4 Rainbow Energy CES 151
        4 Psychic Energy 5
        3 Double Colorless Energy SLG 69`,
    },
    "2016-2017": {
        "Gardevoir": `Pokémon (19)
        4 Ralts BUS 91
        3 Kirlia BUS 92
        3 Gardevoir-GX BUS 93
        1 Gallade BKT 84
        2 Remoraid BKT 31
        1 Octillery BKT 33
        3 Tapu Lele-GX GRI 60
        1 Diancie BUS 94
        1 Alolan Vulpix GRI 21
        
        Trainer (29)
        4 Professor Sycamore BKP 107
        3 N FCO 105
        2 Guzma BUS 115
        1 Brigette BKT 134
        1 Hex Maniac AOR 75
        1 Acerola BUS 112
        4 VS Seeker PHF 109
        4 Ultra Ball SUM 135
        3 Rare Candy SUM 129
        2 Field Blower GRI 125
        1 Rescue Stretcher GRI 130
        1 Super Rod BKT 149
        2 Choice Band GRI 121
        
        Energy (12)
        7 Fairy Energy 9
        4 Double Colorless Energy SUM 136
        1 Wonder Energy PRC 144`,
        "Golisopod Garbodor": `Pokémon (18)
        4 Wimpod BUS 16
        3 Golisopod-GX BUS 17
        4 Trubbish BKP 56
        2 Garbodor BKP 57
        2 Garbodor GRI 51
        2 Tapu Lele-GX GRI 60
        1 Tapu Koko PR-SM 30
        
        Trainer (32)
        4 Professor Sycamore BKP 107
        3 N FCO 105
        2 Guzma BUS 115
        2 Acerola BUS 112
        1 Brigette BKT 134
        1 Teammates PRC 141
        1 Hex Maniac AOR 75
        4 VS Seeker PHF 109
        4 Ultra Ball SUM 135
        2 Rescue Stretcher GRI 130
        1 Field Blower GRI 125
        1 Heavy Ball BKT 140
        4 Float Stone BKT 137
        2 Choice Band GRI 121
        
        Energy (10)
        4 Rainbow Energy SUM 137
        3 Grass Energy 1
        3 Double Colorless Energy SUM 136`,
        "Espeon Garbodor": `Pokémon (18)
        4 Eevee SUM 101
        3 Espeon-GX SUM 61
        1 Flareon AOR 13
        4 Trubbish BKP 56
        3 Garbodor GRI 51
        1 Garbodor BKP 57
        2 Tapu Lele-GX GRI 60
        
        Trainer (30)
        3 Professor Sycamore BKP 107
        3 N FCO 105
        2 Guzma BUS 115
        1 Brigette BKT 134
        1 Hex Maniac AOR 75
        1 Teammates PRC 141
        4 VS Seeker PHF 109
        4 Ultra Ball SUM 135
        2 Field Blower GRI 125
        1 Rescue Stretcher GRI 130
        4 Float Stone BKT 137
        3 Choice Band GRI 121
        1 Parallel City BKT 145
        
        Energy (12)
        8 Psychic Energy 5
        4 Double Colorless Energy SUM 136`,
        "Garbodor Necrozma": `Pokémon (15)
        4 Trubbish BKP 56
        3 Garbodor GRI 51
        1 Garbodor BKP 57
        3 Tapu Lele-GX GRI 60
        1 Necrozma-GX BUS 63
        1 Tapu Koko PR-SM 30
        1 Espeon-EX BKP 52
        1 Mewtwo EVO 51
        
        Trainer (34)
        4 Professor Sycamore BKP 107
        3 N FCO 105
        2 Guzma BUS 115
        1 Brigette BKT 134
        1 Acerola BUS 112
        1 Teammates PRC 141
        1 Ninja Boy STS 103
        4 VS Seeker PHF 109
        4 Ultra Ball SUM 135
        2 Field Blower GRI 125
        2 Rescue Stretcher GRI 130
        2 Enhanced Hammer GRI 124
        4 Float Stone BKT 137
        3 Choice Band GRI 121
        
        Energy (11)
        7 Psychic Energy 5
        4 Double Colorless Energy SUM 136`,
        "Ho-Oh Salazzle": `Pokémon (16)
        3 Ho-Oh-GX BUS 21
        2 Salandit GRI 15
        2 Salazzle-GX BUS 25
        2 Volcanion-EX STS 26
        1 Turtonator-GX GRI 18
        1 Volcanion STS 25
        3 Tapu Lele-GX GRI 60
        1 Shaymin-EX ROS 77
        1 Sudowoodo GRI 66
        
        Trainer (30)
        4 Professor Sycamore BKP 107
        3 Kiawe BUS 116
        3 Guzma BUS 115
        2 N FCO 105
        3 VS Seeker PHF 109
        4 Ultra Ball SUM 135
        2 Switch SUM 132
        2 Max Elixir BKP 102
        2 Super Rod BKT 149
        4 Choice Band GRI 121
        1 Float Stone BKT 137
        
        Energy (14)
        14 Fire Energy 2`,
        "Volcanion": `Pokémon (12)
        3 Volcanion STS 25
        3 Volcanion-EX STS 26
        2 Turtonator-GX GRI 18
        2 Tapu Lele-GX GRI 60
        1 Staryu BKP 25
        1 Starmie EVO 31
        
        Trainer (34)
        4 Professor Sycamore BKP 107
        4 N FCO 105
        3 Guzma BUS 115
        1 Acerola BUS 112
        1 Hex Maniac AOR 75
        3 VS Seeker PHF 109
        3 Ultra Ball SUM 135
        4 Max Elixir BKP 102
        2 Field Blower GRI 125
        1 Rescue Stretcher GRI 130
        3 Fighting Fury Belt BKP 99
        2 Float Stone BKT 137
        3 Brooklet Hill GRI 120
        
        Energy (14)
        14 Fire Energy 2`,
        "Mega Rayquaza": `Pokémon (18)
        4 Rayquaza-EX ROS 75
        3 M Rayquaza-EX ROS 76
        4 Shaymin-EX ROS 77
        2 Hoopa-EX AOR 36
        2 Tapu Lele-GX GRI 60
        1 Tapu Koko-GX GRI 47
        1 Tapu Koko PR-SM 30
        1 Sudowoodo GRI 66
        
        Trainer (33)
        3 Professor Sycamore BKP 107
        2 Guzma BUS 115
        2 Hex Maniac AOR 75
        1 N FCO 105
        1 Skyla BKT 148
        1 Pokémon Fan Club FCO 107
        3 VS Seeker PHF 109
        4 Ultra Ball SUM 135
        3 Mega Turbo ROS 86
        2 Field Blower GRI 125
        1 Rescue Stretcher GRI 130
        2 Rayquaza Spirit Link ROS 87
        2 Float Stone BKT 137
        2 Choice Band GRI 121
        4 Sky Field ROS 89
        
        Energy (9)
        5 Lightning Energy 4
        4 Double Colorless Energy SUM 136`,
        "Greninja": `Pokémon (18)
        4 Froakie BKP 38
        4 Frogadier BKP 39
        4 Greninja BKP 40
        3 Greninja BREAK BKP 41
        1 Remoraid BKT 32
        1 Octillery BKT 33
        1 Tapu Lele-GX GRI 60
        
        Trainer (33)
        4 Professor Sycamore BKP 107
        4 N FCO 105
        1 Guzma BUS 115
        1 Fisherman BKT 136
        4 VS Seeker PHF 109
        4 Dive Ball PRC 125
        4 Ultra Ball SUM 135
        3 Field Blower GRI 125
        1 Rescue Stretcher GRI 130
        1 Super Rod BKT 149
        1 Enhanced Hammer GRI 124
        3 Choice Band GRI 121
        2 Brooklet Hill GRI 120
        
        Energy (9)
        6 Water Energy 3
        3 Splash Energy BKP 113`,
        "Drampa Garbodor": `Pokémon (15)
        3 Drampa-GX GRI 115
        4 Trubbish BKP 56
        3 Garbodor GRI 51
        1 Garbodor BKP 57
        4 Tapu Lele-GX GRI 60
        
        Trainer (33)
        4 N FCO 105
        3 Professor Sycamore BKP 107
        2 Guzma BUS 115
        1 Brigette BKT 134
        1 Teammates PRC 141
        1 Acerola BUS 112
        1 Plumeria BUS 120
        4 VS Seeker PHF 109
        4 Ultra Ball SUM 135
        2 Field Blower GRI 125
        1 Rescue Stretcher GRI 130
        1 Super Rod BKT 149
        4 Float Stone BKT 137
        4 Choice Band GRI 121
        
        Energy (12)
        4 Psychic Energy 5
        4 Rainbow Energy SUM 137
        4 Double Colorless Energy SUM 136`,
    },
    "2015-2016": {
        "Mega Audino": `Pokémon (13)
        4 Audino-EX FCO 84
        3 M Audino-EX FCO 85
        2 Shaymin-EX ROS 77
        1 Hoopa-EX AOR 36
        1 Magearna-EX STS 75
        1 Cobalion STS 74
        1 Absol ROS 40
        
        Trainer (37)
        4 Professor Sycamore BKP 107
        2 N FCO 105
        2 Lysandre AOR 78
        2 AZ PHF 91
        1 Hex Maniac AOR 75
        1 Xerosic PHF 110
        1 Pokémon Center Lady GEN 68
        4 VS Seeker PHF 109
        4 Ultra Ball FCO 113
        4 Trainers' Mail ROS 92
        1 Mega Turbo ROS 86
        1 Escape Rope PRC 127
        1 Super Rod BKT 149
        1 Startling Megaphone FLF 97
        4 Audino Spirit Link FCO 92
        2 Float Stone BKT 137
        2 Parallel City BKT 145
        
        Energy (10)
        6 Metal Energy 8
        4 Double Colorless Energy FCO 114`,
        "Greninja": `Pokémon (18)
        4 Talonflame STS 96
        3 Froakie BKP 38
        4 Frogadier BKP 39
        3 Greninja BKP 40
        1 Greninja XY 41
        3 Greninja BREAK BKP 41
        
        Trainer (32)
        4 Professor Sycamore BKP 107
        4 N FCO 105
        1 Ace Trainer AOR 69
        1 Fisherman BKT 136
        1 Pokémon Ranger STS 104
        4 VS Seeker PHF 109
        4 Dive Ball PRC 125
        2 Level Ball AOR 76
        2 Super Rod BKT 149
        1 Battle Compressor PHF 92
        1 Startling Megaphone FLF 97
        4 Bursting Balloon BKP 97
        3 Rough Seas PRC 137
        
        Energy (10)
        8 Water Energy 3
        2 Splash Energy BKP 113`,
        "Vileplume Toolbox": `Pokémon (21)
        3 Oddish AOR 1
        3 Gloom AOR 2
        3 Vileplume AOR 3
        3 Shaymin-EX ROS 77
        2 Jolteon-EX GEN 28
        2 Glaceon-EX FCO 20
        2 Aegislash-EX PHF 65
        1 Yveltal-EX XY 79
        1 Magearna-EX STS 75
        1 Trevenant-EX PRC 19
        
        Trainer (30)
        4 AZ PHF 91
        4 N FCO 105
        3 Professor Sycamore BKP 107
        2 Lysandre AOR 78
        2 Ninja Boy STS 103
        4 Ultra Ball FCO 113
        4 Trainers' Mail ROS 92
        2 Level Ball AOR 76
        4 Forest of Giant Plants AOR 74
        1 Parallel City BKT 145
        
        Energy (9)
        4 Rainbow Energy BKT 152
        4 Double Colorless Energy FCO 114
        1 Lightning Energy 4`,
        "Vespiquen": `Pokémon (22)
        4 Combee AOR 9
        4 Vespiquen AOR 10
        4 Unown AOR 30
        3 Yveltal STS 65
        2 Remoraid BKT 32
        2 Octillery BKT 33
        1 Shaymin-EX ROS 77
        1 Malamar-EX PHF 58
        1 Druddigon FLF 70
        
        Trainer (29)
        3 Professor Sycamore BKP 107
        2 N FCO 105
        2 Lysandre AOR 78
        1 Brigette BKT 134
        1 Teammates PRC 141
        1 Hex Maniac AOR 75
        1 AZ PHF 91
        4 VS Seeker PHF 109
        4 Ultra Ball FCO 113
        4 Battle Compressor PHF 92
        1 Revitalizer GEN 70
        1 Special Charge STS 105
        2 Muscle Band XY 121
        2 Float Stone BKT 137
        
        Energy (9)
        5 Darkness Energy 7
        4 Double Colorless Energy FCO 114`,
        "Night March": `Pokémon (17)
        4 Joltik PHF 26
        4 Pumpkaboo PHF 44
        4 Lampent PHF 42
        3 Shaymin-EX ROS 77
        2 Mew FCO 29
        
        Trainer (39)
        3 Professor Sycamore BKP 107
        2 Lysandre AOR 78
        2 Hex Maniac AOR 75
        1 N FCO 105
        1 Teammates PRC 141
        1 Pokémon Ranger STS 104
        1 AZ PHF 91
        4 VS Seeker PHF 109
        4 Ultra Ball FCO 113
        4 Battle Compressor PHF 92
        4 Puzzle of Time BKP 109
        3 Trainers' Mail ROS 92
        1 Special Charge STS 105
        1 Startling Megaphone FLF 97
        1 Target Whistle PHF 106
        1 Escape Rope PRC 127
        2 Fighting Fury Belt BKP 99
        3 Dimension Valley PHF 93
        
        Energy (4)
        4 Double Colorless Energy FCO 114`,
        "Bronzong Box": `Pokémon (18)
        4 Bronzor PHF 60
        4 Bronzong PHF 61
        1 Bronzong BREAK FCO 62
        2 Genesect-EX FCO 64
        2 Aegislash-EX PHF 65
        2 Cobalion STS 74
        1 Magearna-EX STS 75
        2 Shaymin-EX ROS 77
        
        Trainer (32)
        4 Professor Sycamore BKP 107
        3 N FCO 105
        2 Lysandre AOR 78
        2 AZ PHF 91
        1 Xerosic PHF 110
        4 VS Seeker PHF 109
        4 Ultra Ball FCO 113
        4 Max Elixir BKP 102
        1 Battle Compressor PHF 92
        3 Fighting Fury Belt BKP 99
        3 Float Stone BKT 137
        1 Sky Field ROS 89
        
        Energy (10)
        10 Metal Energy 8`,
        "Waterbox": `Pokémon (12)
        3 Seismitoad-EX FFI 20
        3 Shaymin-EX ROS 77
        2 Manaphy-EX BKP 32
        1 Hoopa-EX AOR 36
        1 Shaymin-EX PR-XY 148
        1 Glaceon-EX FCO 20
        1 Articuno ROS 17
        
        Trainer (36)
        4 Professor Sycamore BKP 107
        3 N FCO 105
        2 Delinquent BKP 98
        1 Lysandre AOR 78
        1 AZ PHF 91
        1 Xerosic PHF 110
        1 Team Flare Grunt GEN 73
        1 Hex Maniac AOR 75
        4 VS Seeker PHF 109
        4 Ultra Ball FCO 113
        4 Max Elixir BKP 102
        3 Energy Switch GEN 61
        3 Fighting Fury Belt BKP 99
        3 Rough Seas PRC 137
        1 Parallel City BKT 145
        
        Energy (12)
        12 Water Energy 3`,
    },
    "2014-2015": {
        "Archie's Blastoise": `Pokémon (14)
        2 Blastoise PLB 16
        3 Keldeo-EX LTR 45
        2 Jirachi-EX PLB 60
        2 Shaymin-EX ROS 77
        2 Exeggcute PLF 4
        1 Articuno ROS 17
        1 Mewtwo-EX LTR 54
        1 Wailord-EX PRC 38
        
        Trainer (35)
        2 Archie's Ace in the Hole PRC 124
        2 Professor Juniper PLB 84
        1 Lysandre AOR 78
        1 N DEX 96
        4 VS Seeker PHF 109
        4 Ultra Ball ROS 93
        4 Battle Compressor PHF 92
        4 Superior Energy Retrieval PLF 103
        4 Trainers' Mail ROS 92
        4 Acro Bike PRC 122
        1 Computer Search BCR 137
        1 Float Stone PLF 99
        1 Muscle Band XY 121
        2 Rough Seas PRC 137
        
        Energy (11)
        11 Water Energy 3`,
        "Seismitoad Crobat": `Pokémon (18)
        4 Zubat PLS 53
        4 Golbat PHF 32
        3 Crobat PHF 33
        3 Seismitoad-EX FFI 20
        2 Mewtwo-EX LTR 54
        2 Shaymin-EX ROS 77
        
        Trainer (35)
        4 Professor Juniper PLB 84
        3 N DEX 96
        2 Xerosic PHF 110
        1 Lysandre AOR 78
        1 Colress PLS 118
        1 AZ PHF 91
        4 VS Seeker PHF 109
        4 Ultra Ball ROS 93
        4 Hypnotoxic Laser PLS 123
        4 Super Scoop Up FFI 100
        1 Computer Search BCR 137
        3 Muscle Band XY 121
        3 Virbank City Gym PLS 126
        
        Energy (7)
        4 Double Colorless Energy PHF 111
        3 Water Energy 3`,
        "Night March": `Pokémon (19)
        4 Joltik PHF 26
        4 Pumpkaboo PHF 44
        4 Lampent PHF 42
        4 Shaymin-EX ROS 77
        3 Mew-EX DRX 46
        
        Trainer (34)
        2 Professor Juniper PLB 84
        2 N DEX 96
        2 Lysandre AOR 78
        4 VS Seeker PHF 109
        4 Ultra Ball ROS 93
        4 Battle Compressor PHF 92
        4 Trainers' Mail ROS 92
        3 Acro Bike PRC 122
        1 Computer Search BCR 137
        1 Float Stone PLF 99
        1 Muscle Band XY 121
        1 Silver Bangle PLB 88
        1 Hard Charm XY 119
        4 Dimension Valley PHF 93
        
        Energy (7)
        4 Double Colorless Energy PHF 111
        3 Lightning Energy 4`,
        "Trevenant Gengar": `Pokémon (14)
        4 Phantump XY 54
        4 Trevenant XY 55
        3 Gengar-EX PHF 34
        2 Shaymin-EX ROS 77
        1 Jirachi-EX PLB 60
        
        Trainer (36)
        4 Professor Juniper PLB 84
        4 N DEX 96
        3 Wally ROS 94
        2 Lysandre AOR 78
        1 Colress PLS 118
        4 VS Seeker PHF 109
        4 Ultra Ball ROS 93
        3 Trainers' Mail ROS 92
        1 Computer Search BCR 137
        3 Float Stone PLF 99
        3 Muscle Band XY 121
        2 Silent Lab PRC 140
        2 Virbank City Gym PLS 126
        
        Energy (10)
        4 Mystery Energy PHF 112
        4 Double Colorless Energy PHF 111
        2 Psychic Energy 5`,
        "Donphan": `Pokémon (14)
        4 Phanpy PLS 71
        4 Donphan PLS 72
        4 Hawlucha FFI 63
        1 Bunnelby PRC 121
        1 Mr. Mime PLF 47
        
        Trainer (36)
        4 Korrina FFI 95
        4 Professor Juniper PLB 84
        4 N DEX 96
        2 Lysandre AOR 78
        1 Colress PLS 118
        4 VS Seeker PHF 109
        4 Robo Substitute PHF 102
        1 Ultra Ball ROS 93
        1 Repeat Ball PRC 136
        1 Revive ROS 88
        1 Computer Search BCR 137
        2 Focus Sash FFI 91
        2 Muscle Band XY 121
        1 Silver Bangle PLB 88
        3 Fighting Stadium FFI 90
        1 Silent Lab PRC 140
        
        Energy (10)
        4 Strong Energy FFI 104
        4 Fighting Energy 6
        2 Double Colorless Energy PHF 111`,
        "Aromatisse Box": `Pokémon (17)
        2 Spritzee FLF 67
        1 Spritzee XY 92
        2 Aromatisse XY 93
        3 Seismitoad-EX FFI 20
        1 Mewtwo-EX LTR 54
        1 Cobalion-EX PLS 93
        1 Charizard-EX FLF 12
        1 Malamar-EX PHF 58
        1 Keldeo-EX LTR 45
        1 Manectric-EX PHF 23
        1 M Manectric-EX PHF 24
        1 Trevenant-EX PRC 19
        1 Jirachi-EX PLB 60
        
        Trainer (31)
        4 Professor Juniper PLB 84
        4 N DEX 96
        2 Lysandre AOR 78
        2 Colress PLS 118
        1 AZ PHF 91
        1 Pokémon Fan Club FLF 94
        1 Xerosic PHF 110
        3 VS Seeker PHF 109
        3 Max Potion EPO 94
        2 Ultra Ball ROS 93
        1 Sacred Ash FLF 96
        1 Computer Search BCR 137
        2 Muscle Band XY 121
        4 Fairy Garden XY 117
        
        Energy (12)
        5 Fairy Energy 9
        4 Rainbow Energy XY 131
        3 Double Colorless Energy PHF 111`,
        "Primal Groudon": `Pokémon (11)
        3 Groudon-EX PRC 85
        3 Primal Groudon-EX PRC 86
        3 Wobbuffet PHF 36
        1 Landorus-EX BCR 89
        1 Bunnelby PRC 121
        
        Trainer (38)
        4 Professor Juniper PLB 84
        4 Korrina FFI 95
        2 N DEX 96
        2 Lysandre AOR 78
        2 Pokémon Center Lady FLF 93
        1 Colress PLS 118
        1 Teammates PRC 141
        4 VS Seeker PHF 109
        4 Robo Substitute PHF 102
        1 Switch ROS 91
        1 Escape Rope PRC 127
        1 Professor's Letter XY 123
        1 Mega Turbo ROS 86
        1 Ultra Ball ROS 93
        1 Computer Search BCR 137
        2 Hard Charm XY 119
        1 Focus Sash FFI 91
        1 Float Stone PLF 99
        3 Silent Lab PRC 140
        1 Fighting Stadium FFI 90
        
        Energy (11)
        7 Fighting Energy 6
        4 Strong Energy FFI 104`,
        "Mega Manectric": `Pokémon (11)
        4 Manectric-EX PHF 23
        3 M Manectric-EX PHF 24
        2 Genesect-EX PLB 11
        1 Shaymin-EX ROS 77
        1 Deoxys-EX PLF 53
        
        Trainer (38)
        4 Professor Sycamore PHF 101
        3 N DEX 96
        1 Lysandre AOR 78
        1 Skyla BCR 134
        1 Shadow Triad PLF 102
        4 VS Seeker PHF 109
        4 Ultra Ball ROS 93
        3 Trainers' Mail ROS 92
        3 Acro Bike PRC 122
        2 Battle Compressor PHF 92
        2 Max Potion EPO 94
        1 Escape Rope PRC 127
        1 Switch ROS 91
        3 Manectric Spirit Link PHF 100
        2 Muscle Band XY 121
        1 G Booster PLB 92
        2 Rough Seas PRC 137
        
        Energy (11)
        5 Lightning Energy 4
        4 Grass Energy 1
        2 Plasma Energy PLB 91`,
        "Raichu Crobat": `Pokémon (25)
        4 Pikachu XY 42
        4 Raichu XY 43
        4 Zubat PLS 53
        3 Golbat PHF 32
        2 Crobat PHF 33
        2 Hawlucha FFI 63
        1 Bunnelby PRC 121
        4 Shaymin-EX ROS 77
        1 Jirachi-EX PLB 60
        
        Trainer (27)
        3 Colress PLS 118
        2 Professor Juniper PLB 84
        2 N DEX 96
        2 Lysandre AOR 78
        1 AZ PHF 91
        4 VS Seeker PHF 109
        4 Ultra Ball ROS 93
        1 Startling Megaphone FLF 97
        1 Sacred Ash FLF 96
        1 Computer Search BCR 137
        2 Silver Bangle PLB 88
        4 Sky Field ROS 89
        
        Energy (8)
        4 Double Colorless Energy PHF 111
        4 Fighting Energy 6`,

    },
    "2013-2014": {
        "Virizion Genesect": `Pokémon (10)
        4 Virizion-EX PLB 9
        4 Genesect-EX PLB 11
        1 Jirachi-EX PLB 60
        1 Mr. Mime PLF 47
        
        Trainer (37)
        4 Professor Sycamore XY 122
        4 N DEX 96
        4 Skyla BCR 134
        2 Shadow Triad PLF 102
        1 Colress PLS 118
        4 Ultra Ball FLF 99
        3 Energy Switch FFI 89
        2 Enhanced Hammer DEX 94
        2 Tool Scrapper DRX 116
        1 Professor's Letter XY 123
        1 Super Rod DRV 20
        1 Colress Machine PLS 119
        1 Town Map BCR 136
        3 Muscle Band XY 121
        1 G Booster PLB 92
        3 Skyarrow Bridge NXD 91
        
        Energy (13)
        9 Grass Energy 1
        4 Plasma Energy PLB 91`,
        "Aromatisse Kangaskhan": `Pokémon (15)
        3 Spritzee XY 92
        2 Aromatisse XY 93
        2 Kangaskhan-EX FLF 78
        2 M Kangaskhan-EX FLF 79
        2 Mewtwo-EX LTR 54
        1 Xerneas-EX XY 97
        1 Keldeo-EX LTR 45
        1 Xerneas XY 96
        1 Suicune PLB 20
        
        Trainer (34)
        4 N DEX 96
        3 Professor Sycamore XY 122
        3 Colress PLS 118
        2 Lysandre FLF 90
        1 Shauna XY 127
        1 Bianca LTR 109
        3 Max Potion EPO 94
        2 Ultra Ball FLF 99
        2 Level Ball NXD 89
        2 Tool Scrapper DRX 116
        1 Startling Megaphone FLF 97
        1 Heavy Ball NXD 88
        1 Super Rod DRV 20
        1 Dowsing Machine PLS 128
        3 Muscle Band XY 121
        4 Fairy Garden XY 117
        
        Energy (11)
        7 Fairy Energy 9
        2 Double Colorless Energy XY 130
        1 Rainbow Energy XY 131
        1 Water Energy 3`,
        "Yveltal Garbodor": `Pokémon (10)
        3 Yveltal-EX XY 79
        1 Darkrai-EX LTR 88
        1 Sableye DEX 62
        2 Trubbish PLS 65
        2 Garbodor LTR 68
        1 Sawk PLB 52
        
        Trainer (39)
        4 Professor Juniper PLB 84
        4 N DEX 96
        2 Lysandre FLF 90
        1 Colress PLS 118
        4 Ultra Ball FLF 99
        4 Dark Patch DEX 93
        4 Hypnotoxic Laser PLS 123
        4 Bicycle PLS 117
        2 Switch KSS 38
        1 Random Receiver DEX 99
        1 Professor's Letter XY 123
        1 Dowsing Machine PLS 128
        3 Muscle Band XY 121
        2 Float Stone PLF 99
        2 Virbank City Gym PLS 126
        
        Energy (11)
        7 Darkness Energy 7
        4 Double Colorless Energy XY 130`,
        "Plasma Lugia": `Pokémon (9)
        4 Deoxys-EX PLF 53
        2 Thundurus-EX PLF 38
        2 Lugia-EX LTR 102
        1 Kyurem PLF 31
        
        Trainer (39)
        4 Professor Juniper PLB 84
        2 Colress PLS 118
        2 Lysandre FLF 90
        1 Shauna XY 127
        4 Bicycle PLS 117
        4 Colress Machine PLS 119
        3 Roller Skates XY 125
        3 Switch KSS 38
        3 Ultra Ball FLF 99
        2 Team Plasma Ball PLF 105
        2 Escape Rope PLS 120
        2 Tool Scrapper DRX 116
        1 Pal Pad FLF 92
        1 Town Map BCR 136
        1 Computer Search BCR 137
        4 Muscle Band XY 121
        
        Energy (12)
        4 Plasma Energy PLB 91
        4 Double Colorless Energy XY 130
        4 Prism Energy NXD 93`,
        "Blastoise Keldeo": `Pokémon (14)
        3 Squirtle BCR 29
        1 Wartortle BCR 30
        3 Blastoise PLB 16
        2 Keldeo-EX LTR 45
        2 Black Kyurem-EX PLS 95
        1 Black Kyurem BCR 100
        1 Voltorb PLF 32
        1 Electrode PLF 33
        
        Trainer (35)
        4 Skyla BCR 134
        3 Professor Juniper PLB 84
        3 N DEX 96
        1 Colress PLS 118
        1 Lysandre FLF 90
        4 Superior Energy Retrieval PLF 103
        3 Rare Candy PLB 85
        3 Ultra Ball FLF 99
        2 Pokémon Catcher KSS 36
        2 Startling Megaphone FLF 97
        1 Level Ball NXD 89
        1 Heavy Ball NXD 88
        1 Max Potion EPO 94
        1 Professor's Letter XY 123
        1 Super Rod DRV 20
        1 Dowsing Machine PLS 128
        3 Tropical Beach PR-BLW 50
        
        Energy (11)
        9 Water Energy 3
        2 Lightning Energy 4`,
        "Landorus Raichu": `Pokémon (18)
        3 Landorus-EX BCR 89
        1 Mewtwo-EX LTR 54
        3 Pikachu XY 42
        3 Raichu XY 43
        1 Voltorb XY 44
        1 Electrode PLF 33
        1 Jirachi-EX PLB 60
        2 Drifloon PLB 34
        2 Drifblim PLB 35
        1 Palkia-EX PLB 66
        
        Trainer (31)
        4 Professor Juniper PLB 84
        4 N DEX 96
        3 Colress PLS 118
        2 Lysandre FLF 90
        4 Hypnotoxic Laser PLS 123
        3 Ultra Ball FLF 99
        3 Switch KSS 38
        1 Level Ball NXD 89
        1 Computer Search BCR 137
        4 Muscle Band XY 121
        2 Virbank City Gym PLS 126
        
        Energy (11)
        7 Fighting Energy 6
        4 Double Colorless Energy XY 130`,
    },
    "2012-2013": {
        "Darkrai Sableye": `Pokémon (10)
        4 Darkrai-EX DEX 63
        3 Sableye DEX 62
        2 Keldeo-EX BCR 49
        1 Mr. Mime PLF 47
        
        Trainer (40)
        4 Professor Juniper DEX 98
        4 N DEX 96
        4 Dark Patch DEX 93
        4 Pokémon Catcher EPO 95
        4 Hypnotoxic Laser PLS 123
        3 Random Receiver DEX 99
        3 Ultra Ball DEX 102
        3 Energy Switch BLW 94
        2 Bicycle PLS 117
        2 Enhanced Hammer DEX 94
        1 Energy Search BCR 128
        1 Tool Scrapper DRX 116
        1 Computer Search BCR 137
        2 Dark Claw DEX 92
        2 Virbank City Gym PLS 126
        
        Energy (10)
        10 Darkness Energy 7`,
        "Plasma Kyurem": `Pokémon (11)
        3 Deoxys-EX PLF 53
        2 Thundurus-EX PLF 38
        2 Kyurem PLF 31
        2 Keldeo-EX BCR 49
        1 Lugia-EX PLS 108
        1 Absol PLF 67
        
        Trainer (36)
        4 Professor Juniper DEX 98
        4 N DEX 96
        4 Colress PLS 118
        3 Skyla BCR 134
        4 Pokémon Catcher EPO 95
        3 Hypnotoxic Laser PLS 123
        3 Colress Machine PLS 119
        2 Team Plasma Ball PLF 105
        2 Max Potion EPO 94
        1 Ultra Ball DEX 102
        1 Enhanced Hammer DEX 94
        1 Computer Search BCR 137
        3 Float Stone PLF 99
        1 Virbank City Gym PLS 126
        
        Energy (13)
        4 Plasma Energy PLF 106
        4 Prism Energy NXD 93
        4 Blend Energy WLFM DRX 118
        1 Double Colorless Energy NXD 92`,
        "Blastoise Keldeo": `Pokémon (14)
        4 Squirtle BCR 29
        1 Wartortle BCR 30
        4 Blastoise BCR 31
        3 Keldeo-EX BCR 49
        2 Black Kyurem-EX PLS 95
        
        Trainer (35)
        4 Skyla BCR 134
        3 Professor Juniper DEX 98
        3 N DEX 96
        1 Colress PLS 118
        1 Cilan NXD 86
        4 Rare Candy DEX 100
        4 Superior Energy Retrieval PLF 103
        3 Pokémon Catcher EPO 95
        3 Ultra Ball DEX 102
        1 Heavy Ball NXD 88
        1 Level Ball NXD 89
        1 Tool Scrapper DRX 116
        1 Energy Search BCR 128
        1 Computer Search BCR 137
        4 Tropical Beach PR-BLW 50
        
        Energy (11)
        9 Water Energy 3
        2 Lightning Energy 4`,
        "Sableye Garbodor": `Pokémon (11)
        4 Sableye DEX 62
        2 Trubbish DRX 53
        2 Garbodor DRX 54
        2 Darkrai-EX DEX 63
        1 Sneasel NXD 69
        
        Trainer (41)
        4 Professor Juniper DEX 98
        4 N DEX 96
        2 Skyla BCR 134
        1 Ghetsis PLF 101
        4 Pokémon Catcher EPO 95
        3 Crushing Hammer EPO 92
        3 Hypnotoxic Laser PLS 123
        3 Ultra Ball DEX 102
        2 Dark Patch DEX 93
        2 Enhanced Hammer DEX 94
        2 Random Receiver DEX 99
        1 Energy Search BCR 128
        1 Super Rod DRV 20
        1 Switch BCR 135
        1 Tool Scrapper DRX 116
        4 Float Stone PLF 99
        1 Life Dew PLF 107
        2 Virbank City Gym PLS 126
        
        Energy (8)
        8 Darkness Energy 7`,
        "Rayquaza Eelektrik": `Pokémon (15)
        4 Tynamo DEX 45
        4 Eelektrik NVI 40
        3 Rayquaza-EX DRX 85
        2 Keldeo-EX BCR 49
        1 Raikou-EX DEX 38
        1 Rayquaza DRV 11
        
        Trainer (33)
        4 Professor Juniper DEX 98
        4 N DEX 96
        3 Colress PLS 118
        4 Ultra Ball DEX 102
        4 Level Ball NXD 89
        3 Pokémon Catcher EPO 95
        2 Super Rod DRV 20
        1 Energy Search BCR 128
        1 Max Potion EPO 94
        1 Computer Search BCR 137
        3 Float Stone PLF 99
        3 Tropical Beach PR-BLW 50
        
        Energy (12)
        8 Lightning Energy 4
        4 Fire Energy 2`,
        "Flareon": `Pokémon (25)
        4 Eevee PLF 90
        4 Flareon PLF 12
        1 Leafeon PLF 11
        1 Espeon DEX 48
        4 Audino BCR 126
        3 Drifloon DRX 50
        2 Drifblim DRX 51
        2 Trubbish DRX 53
        1 Garbodor DRX 54
        1 Landorus-EX BCR 89
        1 Terrakion NVI 73
        1 Mr. Mime PLF 47
        
        Trainer (27)
        4 Professor Juniper DEX 98
        4 N DEX 96
        2 Colress PLS 118
        4 Ultra Ball DEX 102
        3 Enhanced Hammer DEX 94
        2 Pokémon Catcher EPO 95
        2 Random Receiver DEX 99
        1 Super Rod DRV 20
        1 Computer Search BCR 137
        2 Float Stone PLF 99
        2 Tropical Beach PR-BLW 50
        
        Energy (8)
        4 Double Colorless Energy NXD 92
        4 Fighting Energy 6`,
        "Klinklang": `Pokémon (18)
        4 Klink DEX 75
        2 Klang DEX 76
        2 Klinklang BLW 76
        2 Klinklang PLS 90
        3 Keldeo-EX BCR 49
        2 Cobalion-EX PLS 93
        2 Darkrai-EX DEX 63
        1 Raikou-EX DEX 38
        
        Trainer (32)
        4 N DEX 96
        3 Colress PLS 118
        3 Skyla BCR 134
        1 Professor Juniper DEX 98
        3 Heavy Ball NXD 88
        3 Rare Candy DEX 100
        3 Max Potion EPO 94
        3 Pokémon Catcher EPO 95
        1 Ultra Ball DEX 102
        1 Super Rod DRV 20
        1 Dowsing Machine PLS 128
        1 Float Stone PLF 99
        1 Giant Cape DRX 114
        4 Tropical Beach PR-BLW 50
        
        Energy (10)
        5 Metal Energy 8
        4 Prism Energy NXD 93
        1 Blend Energy WLFM DRX 118`,
    },
    "2011-2012": {
        "Darkrai Mewtwo Terrakion": `Pokémon (12)
        3 Darkrai-EX DEX 63
        3 Mewtwo-EX NXD 54
        2 Terrakion NVI 73
        2 Shaymin UL 8
        2 Smeargle CL 21
        
        Trainer (34)
        4 Professor Oak's New Theory CL 83
        3 Professor Juniper DEX 98
        2 N DEX 96
        4 Junk Arm TM 87
        4 Dark Patch DEX 93
        3 Pokémon Catcher EPO 95
        2 Random Receiver DEX 99
        2 PlusPower BLW 96
        2 Switch BLW 104
        2 Super Scoop Up BLW 103
        2 Ultra Ball DEX 102
        1 Dual Ball CL 78
        3 Eviolite NVI 91
        
        Energy (14)
        7 Darkness Energy 7
        3 Double Colorless Energy NXD 92
        2 Prism Energy NXD 93
        2 Fighting Energy 6`,
        "Darkrai Mewtwo": `Pokémon (10)
        3 Darkrai-EX DEX 63
        3 Mewtwo-EX NXD 54
        2 Shaymin UL 8
        2 Smeargle CL 21
        
        Trainer (37)
        4 Professor Juniper DEX 98
        4 N DEX 96
        2 Professor Oak's New Theory CL 83
        4 Junk Arm TM 87
        4 Dark Patch DEX 93
        3 Pokémon Catcher EPO 95
        3 Ultra Ball DEX 102
        2 Random Receiver DEX 99
        2 PlusPower BLW 96
        2 Switch BLW 104
        2 Potion BLW 100
        1 Max Potion EPO 94
        1 Lost Remover CL 80
        3 Eviolite NVI 91
        
        Energy (13)
        9 Darkness Energy 7
        4 Double Colorless Energy NXD 92`,
        "Celebi Mewtwo Terrakion": `Pokémon (17)
        3 Celebi TM 92
        3 Mewtwo-EX NXD 54
        2 Terrakion NVI 73
        2 Smeargle CL 21
        1 Tornadus-EX DEX 90
        1 Tornadus EPO 89
        1 Virizion NVI 13
        1 Bouffalant BLW 91
        1 Shaymin UL 8
        1 Eevee UD 48
        1 Espeon DEX 48
        
        Trainer (30)
        4 Professor Juniper DEX 98
        4 N DEX 96
        2 Professor Oak's New Theory CL 83
        3 Junk Arm TM 87
        3 Pokémon Catcher EPO 95
        3 Switch BLW 104
        2 Dual Ball CL 78
        2 PlusPower BLW 96
        1 Random Receiver DEX 99
        1 Level Ball NXD 89
        1 Energy Search BLW 93
        1 Super Rod NVI 95
        1 Eviolite NVI 91
        2 Skyarrow Bridge NXD 91
        
        Energy (13)
        6 Grass Energy 1
        4 Double Colorless Energy NXD 92
        3 Fighting Energy 6`,
        "Chandelure Accelgor Lock": `Pokémon (26)
        4 Mew TM 97
        3 Accelgor DEX 11
        3 Litwick PR-BLW 27
        2 Lampent NVI 59
        2 Chandelure NVI 60
        3 Oddish UD 60
        2 Vileplume UD 24
        2 Darkrai-EX DEX 63
        1 Relicanth CL 69
        1 Pichu HS 28
        1 Smeargle CL 21
        1 Shaymin UL 8
        1 Terrakion NVI 73
        
        Trainer (24)
        4 Twins TM 89
        4 Professor Oak's New Theory CL 83
        4 Sage's Training CL 85
        3 Professor Juniper DEX 98
        4 Pokémon Communication BLW 99
        4 Rare Candy DEX 100
        1 Tropical Beach PR-BLW 50
        
        Energy (10)
        4 Rainbow Energy HS 104
        4 Double Colorless Energy NXD 92
        2 Prism Energy NXD 93`,
    },
};
  
export const getRandomDeckList = () => {
    const years = Object.keys(decklistsByYear);
    const randomYear = years[Math.floor(Math.random() * years.length)];
    const decks = Object.keys(decklistsByYear[randomYear]);
    const randomDeck = decks[Math.floor(Math.random() * decks.length)];
    return decklistsByYear[randomYear][randomDeck];
}

export const showDecklistsContextMenu = (event) => {
    decklistsContextMenu.innerHTML = '';

    for (const year of Object.keys(decklistsByYear)) {
        const yearItem = document.createElement('div');
        yearItem.classList.add('decklists-context-menu-item');
        yearItem.textContent = year;

        const deckSubMenu = document.createElement('div');
        deckSubMenu.classList.add('decklists-context-menu-submenu');

        for (const deck of Object.keys(decklistsByYear[year])) {
            const deckItem = document.createElement('div');
            deckItem.classList.add('decklists-context-menu-item');
            deckItem.textContent = deck;
            deckItem.addEventListener('click', () => {
                const input = mainDeckImportInput.style.display !== 'none' ? mainDeckImportInput : altDeckImportInput;
                input.value = '';
                input.value = decklistsByYear[year][deck];
                decklistsContextMenu.style.display = 'none';
            });

            deckSubMenu.appendChild(deckItem);

            // Add event listener for mouseover to highlight/bold the item
            deckItem.addEventListener('mouseover', () => {
                deckItem.classList.add('decklist-highlight');
            });

            // Add event listener for mouseout to remove the highlight/bold
            deckItem.addEventListener('mouseout', () => {
                deckItem.classList.remove('decklist-highlight');
            });
        }

        yearItem.appendChild(deckSubMenu);
        decklistsContextMenu.appendChild(yearItem);

        // Add event listener for mouseover to show the submenu
        yearItem.addEventListener('mouseover', () => {
            deckSubMenu.style.display = 'block';
            yearItem.style.fontWeight = 'bold';
        });

        // Add event listener for mouseout to hide the submenu
        yearItem.addEventListener('mouseout', () => {
            deckSubMenu.style.display = 'none';
            yearItem.style.fontWeight = 'normal';
        });
    }

    const adjustment = deckImport.offsetHeight - decklistsButton.offsetTop
    decklistsContextMenu.style.bottom = `${adjustment}px`;
    
    

    decklistsContextMenu.style.display = 'block';
    // Use mousedown event to hide the menu when clicking outside
    document.addEventListener('mousedown', hidedecklistsContextMenu);
};



// Function to hide the context menu
export const hidedecklistsContextMenu = (event) => {
    if (!decklistsContextMenu.contains(event.target)) {
        decklistsContextMenu.style.display = 'none';
        document.removeEventListener('mousedown', hidedecklistsContextMenu);
    }
};

